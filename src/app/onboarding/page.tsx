import { Check, ChevronRight } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { topicTree, userInterests } from "@/lib/mock-data";

export default function OnboardingPage() {
  const selectedIds = new Set(
    userInterests.filter((interest) => interest.selected).map((item) => item.id),
  );
  const rootTopics = topicTree.filter((topic) => !topic.parentId);
  const algorithmChildren = topicTree.filter(
    (topic) => topic.parentId === "algorithms",
  );

  return (
    <AppShell
      title="Topics"
      subtitle="Choose broad areas first, then refine the graph with related CS topics."
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="space-y-5">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-black uppercase tracking-normal text-slate-500">
              Broad areas
            </h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {rootTopics.map((topic) => {
                const isSelected = selectedIds.has(topic.id);

                return (
                  <button
                    key={topic.id}
                    className={`flex min-h-16 items-center justify-between rounded-lg border px-4 py-3 text-left ${
                      isSelected
                        ? "border-teal-300 bg-teal-50 text-teal-950"
                        : "border-slate-200 bg-white text-slate-800"
                    }`}
                  >
                    <span className="text-sm font-black">{topic.label}</span>
                    {isSelected ? (
                      <Check aria-hidden="true" size={18} strokeWidth={2.5} />
                    ) : (
                      <ChevronRight
                        aria-hidden="true"
                        size={18}
                        strokeWidth={2.5}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-black uppercase tracking-normal text-slate-500">
              Algorithms
            </h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {algorithmChildren.map((topic) => (
                <button
                  key={topic.id}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-900"
                >
                  {topic.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <aside className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-normal text-slate-500">
            Selected
          </h2>
          <div className="mt-4 space-y-2">
            {userInterests
              .filter((interest) => interest.selected)
              .map((interest) => (
                <div
                  key={interest.id}
                  className="flex items-center justify-between rounded-lg bg-slate-100 px-3 py-2"
                >
                  <span className="text-sm font-bold text-slate-800">
                    {interest.label}
                  </span>
                  <Check
                    aria-label="Selected"
                    className="text-teal-700"
                    size={17}
                    strokeWidth={2.5}
                  />
                </div>
              ))}
          </div>
          <button className="mt-5 h-11 w-full rounded-lg bg-slate-950 text-sm font-black text-white">
            Continue
          </button>
        </aside>
      </div>
    </AppShell>
  );
}
