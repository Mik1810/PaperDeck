import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import {
  GroupPaperAddButton,
  ResearchGroupManagement,
} from "@/components/research-group-controls";
import { ResearchGroupPaperList } from "@/components/research-group-paper-list";
import { requireOwnerId } from "@/lib/auth/session";
import { ResearchGroupUnavailableError } from "@/lib/research-groups/permissions";
import { loadResearchGroupWorkspace } from "@/lib/repositories/research-group-workspace";

export const dynamic = "force-dynamic";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function ResearchGroupPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const ownerId = await requireOwnerId();
  const { groupId } = await params;
  if (!uuidPattern.test(groupId)) notFound();

  const { group, paperPage, members, preference, readLaterCount } =
    await loadResearchGroupWorkspace(ownerId, groupId).catch((error) => {
      if (error instanceof ResearchGroupUnavailableError) notFound();
      throw error;
    });

  return (
      <AppShell
        title={group.name}
        subtitle={group.description || "One private, chronological shared paper list."}
        action={<GroupPaperAddButton groupId={group.id} />}
        readLaterCount={readLaterCount}
      >
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <ResearchGroupPaperList
            groupId={group.id}
            initialPage={paperPage}
            key={`${group.revision}:${paperPage.totalCount}:${paperPage.items[0]?.paper.id ?? "empty"}`}
            role={group.role}
          />

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
