import { createRequire } from "node:module";
import postgres from "postgres";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env") as typeof import("@next/env");

type ProbeOptions = {
  concurrency: number;
  iterations: number;
  maxConnections: number;
  deadlineMs: number;
  shape: "auto" | "raw" | "groups" | "invitations" | "read-later" | "index";
};

type ProbeFailure = {
  name: string;
  code: string | null;
};

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function optionsFromArguments(): ProbeOptions {
  const values = new Map<string, string>();
  for (const argument of process.argv.slice(2)) {
    const [key, value] = argument.split("=", 2);
    if (key.startsWith("--") && value) values.set(key.slice(2), value);
  }

  const shape = values.get("shape") ?? "auto";
  if (!["auto", "raw", "groups", "invitations", "read-later", "index"].includes(shape)) {
    throw new Error("Invalid probe shape");
  }

  return {
    concurrency: positiveInteger(values.get("concurrency"), 12),
    iterations: positiveInteger(values.get("iterations"), 4),
    maxConnections: positiveInteger(values.get("max-connections"), 3),
    deadlineMs: positiveInteger(values.get("deadline-ms"), 15_000),
    shape: shape as ProbeOptions["shape"],
  };
}

function percentile(values: number[], fraction: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function sanitizedFailure(error: unknown): ProbeFailure {
  const candidate = error as { name?: unknown; code?: unknown };
  return {
    name: typeof candidate?.name === "string" ? candidate.name : "Error",
    code: typeof candidate?.code === "string" ? candidate.code : null,
  };
}

async function withDeadline<T>(task: Promise<T>, deadlineMs: number) {
  let timeout: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      const error = new Error("Transaction pooler probe deadline exceeded");
      error.name = "ProbeDeadlineError";
      reject(error);
    }, deadlineMs);
  });

  try {
    return await Promise.race([task, deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function main() {
  loadEnvConfig(process.cwd());
  const options = optionsFromArguments();
  const configuredUrl = process.env.DATABASE_URL;

  if (!configuredUrl) throw new Error("DATABASE_URL is required");

  const transactionUrl = new URL(configuredUrl);
  if (!transactionUrl.hostname.endsWith("pooler.supabase.com")) {
    throw new Error("DATABASE_URL must use the Supabase shared pooler");
  }
  transactionUrl.port = "6543";

  const bootstrapOptions = {
    max: 1,
    prepare: false,
    fetch_types: false,
    idle_timeout: 5,
    connect_timeout: 10,
  };
  const bootstrap = postgres(transactionUrl.toString(), bootstrapOptions);

  let actorOwnerId: string | undefined;
  let groupId: string | undefined;
  let readsEnabled = false;
  let writesEnabled = false;
  let activeGroups = 0;

  try {
    const settings = await bootstrap<{
      reads_enabled: boolean;
      writes_enabled: boolean;
      active_groups: number;
    }[]>`
      select
        settings.reads_enabled,
        settings.writes_enabled,
        (
          select count(*)::integer
          from research_groups
          where state = 'active'
        ) as active_groups
      from private.research_group_runtime_settings as settings
      where settings.singleton
    `;
    readsEnabled = settings[0]?.reads_enabled ?? false;
    writesEnabled = settings[0]?.writes_enabled ?? false;
    activeGroups = Number(settings[0]?.active_groups ?? 0);

    const workspaceCandidate = await bootstrap<{
      member_id: string;
      group_id: string;
    }[]>`
      select membership.member_id, membership.group_id
      from research_group_members as membership
      inner join research_groups as group_row
        on group_row.id = membership.group_id
       and group_row.state = 'active'
      where membership.revoked_at is null
      order by membership.joined_at, membership.group_id
      limit 1
    `;
    actorOwnerId = workspaceCandidate[0]?.member_id;
    groupId = workspaceCandidate[0]?.group_id;

    if (!actorOwnerId) {
      const profileCandidate = await bootstrap<{ owner_id: string }[]>`
        select owner_id
        from profiles
        order by created_at
        limit 1
      `;
      actorOwnerId = profileCandidate[0]?.owner_id;
    }
  } finally {
    await bootstrap.end({ timeout: 5 });
  }

  if (!actorOwnerId) throw new Error("No local probe actor is available");

  process.env.DATABASE_URL = transactionUrl.toString();
  process.env.DATABASE_MAX_CONNECTIONS = String(options.maxConnections);

  const [
    { db },
    drizzle,
    groupsRepository,
    invitationsRepository,
    userDataRepository,
    workspaceRepository,
  ] = await Promise.all([
    import("@/db"),
    import("drizzle-orm"),
    import("@/lib/repositories/research-groups"),
    import("@/lib/repositories/research-group-invitations"),
    import("@/lib/repositories/user-data"),
    import("@/lib/repositories/research-group-workspace"),
  ]);

  const routeShape = options.shape === "auto"
    ? groupId ? "workspace" : "index"
    : options.shape;
  const loads = {
    raw: async () => Number((await db.execute<{ value: number }>(drizzle.sql`select 1::integer as value`)).rows[0]?.value ?? 0),
    groups: async () => (await groupsRepository.listResearchGroups(actorOwnerId)).length,
    invitations: async () => (
      await invitationsRepository.listIncomingResearchGroupInvitations(actorOwnerId)
    ).length,
    "read-later": () => userDataRepository.getReadLaterCount(actorOwnerId),
    index: async () => {
      const groups = await groupsRepository.listResearchGroups(actorOwnerId);
      const [invitations, readLaterCount] = await Promise.all([
        invitationsRepository.listIncomingResearchGroupInvitations(actorOwnerId),
        userDataRepository.getReadLaterCount(actorOwnerId),
      ]);
      return groups.length + invitations.length + readLaterCount;
    },
    workspace: async () => {
      if (!groupId) throw new Error("No active group is available for workspace probe");
      const workspace = await workspaceRepository.loadResearchGroupWorkspace(
        actorOwnerId,
        groupId,
      );
      return workspace.papers.length + workspace.members.length;
    },
  };
  const load = loads[routeShape];

  await withDeadline(load(), options.deadlineMs);

  const durations: number[] = [];
  const failures: ProbeFailure[] = [];
  let attempted = 0;
  for (let iteration = 0; iteration < options.iterations; iteration += 1) {
    attempted += options.concurrency;
    const batch = Array.from({ length: options.concurrency }, async () => {
      const startedAt = performance.now();
      try {
        await withDeadline(load(), options.deadlineMs);
        durations.push(performance.now() - startedAt);
      } catch (error) {
        failures.push(sanitizedFailure(error));
      }
    });
    await Promise.all(batch);
    if (failures.length) break;
  }

  const report = {
    target: "transaction-pooler",
    port: 6543,
    driver: "node-postgres",
    named_prepared_statements: false,
    max_connections: options.maxConnections,
    route_shape: routeShape,
    reads_enabled: readsEnabled,
    writes_enabled: writesEnabled,
    active_groups: activeGroups,
    configured_requests: options.concurrency * options.iterations,
    attempted,
    completed: durations.length,
    failures: failures.length,
    failure_kinds: [...new Set(failures.map((failure) => JSON.stringify(failure)))].map(
      (failure) => JSON.parse(failure) as ProbeFailure,
    ),
    latency_ms: {
      p50: Number(percentile(durations, 0.5).toFixed(1)),
      p95: Number(percentile(durations, 0.95).toFixed(1)),
      max: Number(Math.max(0, ...durations).toFixed(1)),
    },
    mutations: 0,
    identifiers_reported: 0,
  };

  console.log(JSON.stringify(report, null, 2));
  if (failures.length) {
    setTimeout(() => process.exit(1), 100);
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      target: "transaction-pooler",
      probe_failed: true,
      ...sanitizedFailure(error),
    }),
  );
  process.exitCode = 1;
});
