import { AppShell } from "@/components/app-shell";
import { userInterests } from "@/lib/mock-data";

export default function SettingsPage() {
  return (
    <AppShell
      title="Settings"
      subtitle="Account, ranking preferences, digest cadence, and source controls."
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-normal text-slate-500">
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

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
          <h2 className="text-sm font-black uppercase tracking-normal text-slate-500">
            Interests
          </h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {userInterests.map((interest) => (
              <span
                key={interest.id}
                className={`rounded-lg px-3 py-2 text-sm font-bold ${
                  interest.selected
                    ? "bg-teal-50 text-teal-800"
                    : "bg-slate-100 text-slate-500"
                }`}
              >
                {interest.label}
              </span>
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
