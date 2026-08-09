import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PaperListItem } from "@/components/paper-list-item";
import {
  GroupPaperActions,
  GroupPaperAddButton,
  ResearchGroupManagement,
} from "@/components/research-group-controls";
import { requireOwnerId } from "@/lib/auth/session";
import { ResearchGroupUnavailableError } from "@/lib/research-groups/permissions";
import {
  getResearchGroupPaperNotificationPreference,
  listResearchGroupPapers,
} from "@/lib/repositories/research-group-papers";
import {
  getResearchGroup,
  listResearchGroupMembers,
} from "@/lib/repositories/research-groups";
import { getReadLaterCount } from "@/lib/repositories/user-data";

export const dynamic = "force-dynamic";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function addedAtLabel(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}

async function loadResearchGroupPage(ownerId: string, groupId: string) {
  return Promise.all([
    getResearchGroup(ownerId, groupId),
    listResearchGroupPapers(ownerId, groupId),
    listResearchGroupMembers(ownerId, groupId),
    getResearchGroupPaperNotificationPreference(ownerId, groupId),
    getReadLaterCount(ownerId),
  ]);
}

export default async function ResearchGroupPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const ownerId = await requireOwnerId();
  const { groupId } = await params;
  if (!uuidPattern.test(groupId)) notFound();

  const data = await loadResearchGroupPage(ownerId, groupId).catch((error) => {
    if (error instanceof ResearchGroupUnavailableError) notFound();
    throw error;
  });
  const [group, papers, members, preference, readLaterCount] = data;

  return (
      <AppShell
        title={group.name}
        subtitle={group.description || "One private, chronological shared paper list."}
        action={<GroupPaperAddButton groupId={group.id} />}
        readLaterCount={readLaterCount}
      >
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="min-w-0 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-black uppercase tracking-normal text-slate-500">
                Shared papers · {papers.length}
              </h2>
              <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-black uppercase text-slate-600">
                {group.role}
              </span>
            </div>
            {papers.length ? (
              papers.map((item) => (
                <PaperListItem
                  key={item.paper.id}
                  paper={item.paper}
                  meta={
                    <p className="text-xs font-bold text-slate-500">
                      Added by {item.contributor?.displayName || "Former member"} · {addedAtLabel(item.addedAt)}
                    </p>
                  }
                  action={
                    <GroupPaperActions
                      canRemove={item.canRemove}
                      groupId={group.id}
                      paperId={item.paper.id}
                    />
                  }
                />
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
                <h2 className="text-base font-black text-slate-950">This group is empty</h2>
                <p className="mt-1 text-sm font-medium text-slate-500">
                  Add the first catalog paper when the group is ready.
                </p>
              </div>
            )}
          </section>

          <ResearchGroupManagement
            groupId={group.id}
            members={members}
            preference={preference}
            role={group.role}
          />
        </div>
      </AppShell>
  );
}
