import Link from "next/link";
import { ArrowRight, Mail, Users } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import {
  GroupCreateButton,
  GroupInvitationDecision,
} from "@/components/research-group-controls";
import { requireUserContext } from "@/lib/auth/session";
import { ResearchGroupUnavailableError } from "@/lib/research-groups/permissions";
import { listIncomingResearchGroupInvitations } from "@/lib/repositories/research-group-invitations";
import { listResearchGroups } from "@/lib/repositories/research-groups";
import {
  ensureUserProfile,
  getReadLaterCount,
} from "@/lib/repositories/user-data";

export const dynamic = "force-dynamic";

async function loadResearchGroupsPage(ownerId: string) {
  return Promise.all([
    listResearchGroups(ownerId),
    listIncomingResearchGroupInvitations(ownerId),
    getReadLaterCount(ownerId),
  ]);
}

export default async function ResearchGroupsPage() {
  const user = await requireUserContext();
  await ensureUserProfile(user);

  const data = await loadResearchGroupsPage(user.ownerId).catch((error) => {
    if (error instanceof ResearchGroupUnavailableError) return null;
    throw error;
  });

  if (!data) {
    const readLaterCount = await getReadLaterCount(user.ownerId);
    return (
      <AppShell
        title="Research groups"
        subtitle="Private shared paper lists for small research teams."
        readLaterCount={readLaterCount}
      >
        <section className="rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
          <Users aria-hidden="true" className="mx-auto text-slate-300" size={34} />
          <h2 className="mt-3 text-base font-black text-slate-950">Groups are not available yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm font-medium leading-6 text-slate-500">
            The private group pilot is currently disabled. No group or personal data was changed.
          </p>
        </section>
      </AppShell>
    );
  }

  const [groups, invitations, readLaterCount] = data;
  return (
      <AppShell
        title="Research groups"
        subtitle="Private spaces for one shared, chronological paper list."
        action={<GroupCreateButton />}
        readLaterCount={readLaterCount}
      >
        <div className="space-y-6">
          {invitations.length ? (
            <section>
              <div className="mb-3 flex items-center gap-2">
                <Mail aria-hidden="true" size={17} className="text-slate-500" />
                <h2 className="text-sm font-black uppercase tracking-normal text-slate-500">
                  Invitations
                </h2>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {invitations.map((invitation) => (
                  <article
                    key={invitation.id}
                    className="rounded-lg border border-teal-200 bg-teal-50/60 p-4 shadow-sm"
                  >
                    <p className="text-sm font-black text-slate-950">
                      {invitation.group.name}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-slate-600">
                      Invited by {invitation.inviter.displayName || "a member"}
                    </p>
                    <div className="mt-3">
                      <GroupInvitationDecision invitationId={invitation.id} />
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <div className="mb-3 flex items-center gap-2">
              <Users aria-hidden="true" size={17} className="text-slate-500" />
              <h2 className="text-sm font-black uppercase tracking-normal text-slate-500">
                Your groups · {groups.length}
              </h2>
            </div>
            {groups.length ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {groups.map((group) => (
                  <Link
                    key={group.id}
                    href={`/groups/${group.id}`}
                    className="group rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="truncate text-base font-black text-slate-950">
                          {group.name}
                        </h2>
                        <span className="mt-1 inline-flex rounded-md bg-slate-100 px-2 py-1 text-[10px] font-black uppercase text-slate-600">
                          {group.role}
                        </span>
                      </div>
                      <ArrowRight
                        aria-hidden="true"
                        size={18}
                        className="shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-slate-700"
                      />
                    </div>
                    <p className="mt-3 line-clamp-2 min-h-10 text-sm font-medium leading-5 text-slate-600">
                      {group.description || "No description yet."}
                    </p>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
                <Users aria-hidden="true" className="mx-auto text-slate-300" size={32} />
                <h2 className="mt-3 text-base font-black text-slate-950">No research groups yet</h2>
                <p className="mt-1 text-sm font-medium text-slate-500">
                  Create an empty group or accept an invitation to get started.
                </p>
              </div>
            )}
          </section>
        </div>
      </AppShell>
  );
}
