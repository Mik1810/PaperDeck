import { AppShell } from "@/components/app-shell";
import { requireUserContext } from "@/lib/auth/session";
import {
  ensureUserProfile,
  getSettingsPageData,
  hasUsableOnboardingState,
} from "@/lib/repositories/user-data";
import { SettingsInterestEditor } from "@/components/settings-interest-editor";
import { CollaborationSettingsEditor } from "@/components/collaboration-settings-editor";
import { ConnectionsManager } from "@/components/connections-manager";
import {
  getCollaborationConnections,
  getCollaborationSettings,
} from "@/lib/repositories/collaboration";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUserContext();
  const ownerId = user.ownerId;
  await ensureUserProfile(user);

  if (!(await hasUsableOnboardingState(ownerId))) {
    redirect("/onboarding");
  }

  const [{ interests, readLaterCount }, collaboration, connections] = await Promise.all([
    getSettingsPageData(ownerId),
    getCollaborationSettings(ownerId),
    getCollaborationConnections(),
  ]);
  const safeDisplayName = collaboration.displayName.includes("@")
    ? ""
    : collaboration.displayName;

  return (
    <AppShell
      title="Settings"
      subtitle="Account, ranking preferences, digest cadence, and source controls."
      readLaterCount={readLaterCount}
    >
      <div className="grid gap-5 md:grid-cols-2">
        <CollaborationSettingsEditor
          initialDiscoverableByEmail={collaboration.discoverableByEmail}
          initialDisplayName={safeDisplayName}
          initialGroupInvitePolicy={collaboration.groupInvitePolicy}
        />

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-normal text-slate-500">
            Digest
          </h2>
          <div className="mt-4 flex items-center justify-between gap-4 rounded-lg bg-slate-100 px-3 py-3">
            <span className="text-sm font-bold text-slate-700">In-app</span>
            <span className="text-sm font-black text-teal-700">Daily</span>
          </div>
        </section>

        <ConnectionsManager connections={connections} />

        <SettingsInterestEditor interests={interests} />
      </div>
    </AppShell>
  );
}
