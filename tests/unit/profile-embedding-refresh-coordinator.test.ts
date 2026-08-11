import assert from "node:assert/strict";
import test from "node:test";
import {
  createRefreshCoalescer,
  refreshLatestGeneration,
} from "../../src/lib/profile-embedding-refresh-coordinator";

test("refreshLatestGeneration retries a superseded computation", async () => {
  let attempts = 0;

  const result = await refreshLatestGeneration(async () => {
    attempts += 1;
    return attempts === 1
      ? { committed: false as const }
      : { committed: true as const, value: "generation-2" };
  });

  assert.equal(result, "generation-2");
  assert.equal(attempts, 2);
});

test("refreshLatestGeneration stops after the retry budget", async () => {
  let attempts = 0;

  const result = await refreshLatestGeneration(async () => {
    attempts += 1;
    return { committed: false as const };
  }, 3);

  assert.equal(result, null);
  assert.equal(attempts, 3);
});

test("createRefreshCoalescer shares concurrent work and runs one trailing refresh", async () => {
  let releaseFirst!: () => void;
  const firstBlocked = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let calls = 0;
  const refresh = createRefreshCoalescer(async () => {
    calls += 1;
    if (calls === 1) {
      await firstBlocked;
    }
    return calls;
  });

  const first = refresh("owner-a");
  const second = refresh("owner-a");

  assert.equal(first, second);
  releaseFirst();

  assert.equal(await first, 2);
  assert.equal(calls, 2);
});

test("createRefreshCoalescer does not combine different owners", async () => {
  const owners: string[] = [];
  const refresh = createRefreshCoalescer(async (ownerId) => {
    owners.push(ownerId);
    return ownerId;
  });

  await Promise.all([refresh("owner-a"), refresh("owner-b")]);

  assert.deepEqual(owners.sort(), ["owner-a", "owner-b"]);
});
