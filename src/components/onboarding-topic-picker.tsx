"use client";

import { useState } from "react";
import { Check, ChevronRight } from "lucide-react";
import { saveOnboardingInterestsAction } from "@/app/actions";

export type TopicOption = {
  id: string;
  label: string;
  parentId: string | null;
  depth: number;
};

type OnboardingTopicPickerProps = {
  topics: TopicOption[];
  initialSelectedTopicIds: string[];
};

export function OnboardingTopicPicker({
  topics,
  initialSelectedTopicIds,
}: OnboardingTopicPickerProps) {
  const [selectedTopicIds, setSelectedTopicIds] = useState(
    () => new Set(initialSelectedTopicIds),
  );
  const rootTopics = topics.filter((topic) => !topic.parentId);
  const childTopics = topics.filter((topic) => {
    if (!topic.parentId) {
      return false;
    }

    return selectedTopicIds.has(topic.parentId) || topic.depth <= 1;
  });

  const selectedTopics = topics.filter((topic) => selectedTopicIds.has(topic.id));

  function toggleTopic(topicId: string) {
    setSelectedTopicIds((current) => {
      const next = new Set(current);

      if (next.has(topicId)) {
        next.delete(topicId);
      } else {
        next.add(topicId);
      }

      return next;
    });
  }

  return (
    <form
      action={saveOnboardingInterestsAction}
      className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]"
    >
      {[...selectedTopicIds].map((topicId) => (
        <input key={topicId} name="topicId" type="hidden" value={topicId} />
      ))}

      <section className="space-y-5">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-black uppercase tracking-normal text-slate-500">
            Broad areas
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {rootTopics.map((topic) => {
              const isSelected = selectedTopicIds.has(topic.id);

              return (
                <button
                  key={topic.id}
                  className={`flex min-h-16 items-center justify-between rounded-lg border px-4 py-3 text-left ${
                    isSelected
                      ? "border-teal-300 bg-teal-50 text-teal-950"
                      : "border-slate-200 bg-white text-slate-800"
                  }`}
                  type="button"
                  onClick={() => toggleTopic(topic.id)}
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
            Refine topics
          </h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {childTopics.map((topic) => {
              const isSelected = selectedTopicIds.has(topic.id);

              return (
                <button
                  key={topic.id}
                  className={`rounded-lg border px-3 py-2 text-sm font-bold ${
                    isSelected
                      ? "border-teal-300 bg-teal-50 text-teal-900"
                      : "border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-900"
                  }`}
                  type="button"
                  onClick={() => toggleTopic(topic.id)}
                >
                  {topic.label}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <aside className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-black uppercase tracking-normal text-slate-500">
          Selected
        </h2>
        <div className="mt-4 space-y-2">
          {selectedTopics.length ? (
            selectedTopics.map((topic) => (
              <div
                key={topic.id}
                className="flex items-center justify-between rounded-lg bg-slate-100 px-3 py-2"
              >
                <span className="text-sm font-bold text-slate-800">
                  {topic.label}
                </span>
                <Check
                  aria-label="Selected"
                  className="text-teal-700"
                  size={17}
                  strokeWidth={2.5}
                />
              </div>
            ))
          ) : (
            <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-bold text-slate-500">
              Select at least one topic to tune the deck.
            </p>
          )}
        </div>
        <button className="mt-5 h-11 w-full rounded-lg bg-slate-950 text-sm font-black text-white">
          Continue
        </button>
      </aside>
    </form>
  );
}
