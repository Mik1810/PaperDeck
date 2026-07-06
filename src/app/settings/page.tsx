import { AppShell } from "@/components/app-shell";
import { requireOwnerId } from "@/lib/auth/session";
import {
  getSettingsPageData,
  hasUsableOnboardingState,
} from "@/lib/repositories/user-data";
import { SettingsInterestEditor } from "@/components/settings-interest-editor";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const ownerId = await requireOwnerId();

  if (!(await hasUsableOnboardingState(ownerId))) {
    redirect("/onboarding");
  }

  const { interests, readLaterCount } = await getSettingsPageData(ownerId);

  return (
    <AppShell
      title="Settings"
      subtitle="Account, ranking preferences, digest cadence, and source controls."
      readLaterCount={readLaterCount}
    >
      <div className="grid gap-5 md:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm md:p-5 lg:p-6">
          <h2 className="text-sm font-black uppercase tracking-normal text-slate-500 md:text-base">
            Profile
          </h2>
          <dl className="mt-4 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-sm font-bold text-slate-500">Login</dt>
              <dd className="text-sm font-black text-slate-900">Google</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-sm font-bold text-slate-500">Visibility</dt>
              <dd className="text-sm font-black text-slate-900">Private</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-normal text-slate-500">
            Digest
          </h2>
          <div className="mt-4 flex items-center justify-between gap-4 rounded-lg bg-slate-100 px-3 py-3">
            <span className="text-sm font-bold text-slate-700">In-app</span>
            <span className="text-sm font-black text-teal-700">Daily</span>
          </div>
        </section>

        <SettingsInterestEditor interests={interests} />
      </div>
    </AppShell>
  );
}
