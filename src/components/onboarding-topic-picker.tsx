"use client";

import { useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import {
  saveOnboardingInterestsAction,
  skipOnboardingAction,
} from "@/app/actions";
import {
  topicGranularity,
  topicMacroGroups,
  topicMatchesMacro,
} from "@/lib/topic-taxonomy";
import { normalizePublicDisplayName } from "@/lib/collaboration/profile";

export type TopicOption = {
  arxivCategory: string | null;
  depth: number;
  id: string;
  label: string;
  parentId: string | null;
  slug: string;
  source: string | null;
};

type OnboardingTopicPickerProps = {
  devAuthEnabled?: boolean;
  initialDisplayName?: string;
  topics: TopicOption[];
};

const steps = ["Profile", "Macro", "Categories", "Micro"] as const;
const loadingMessages = [
  "Saving your interests",
  "Building your preference vector",
  "Ranking your first papers",
] as const;

function optionButtonClass(isSelected: boolean) {
  return `flex min-h-12 items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left text-sm font-black transition-colors ${
    isSelected
      ? "border-teal-300 bg-teal-300 text-zinc-950"
      : "border-zinc-700 bg-zinc-900 text-zinc-100 hover:border-zinc-500 hover:bg-zinc-800"
  }`;
}

function chipButtonClass(isSelected: boolean) {
  return `rounded-lg border px-3 py-2 text-sm font-bold transition-colors ${
    isSelected
      ? "border-teal-300 bg-teal-300 text-zinc-950"
      : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-zinc-500 hover:bg-zinc-800"
  }`;
}

function OnboardingLoadingOverlay() {
  const { pending } = useFormStatus();
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    if (!pending) {
      return;
    }

    const interval = window.setInterval(() => {
      setMessageIndex((current) => (current + 1) % loadingMessages.length);
    }, 1400);

    return () => window.clearInterval(interval);
  }, [pending]);

  if (!pending) {
    return null;
  }

  return (
    <div
      aria-live="polite"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#151515] px-6"
      role="status"
    >
      <div className="w-full max-w-sm text-center">
        <Loader2
          aria-hidden="true"
          className="mx-auto animate-spin text-teal-300"
          size={36}
          strokeWidth={2.5}
        />
        <h2 className="mt-5 text-lg font-black text-zinc-50">
          Building your PaperDeck
        </h2>
        <p className="mt-2 text-sm font-bold text-zinc-400">
          {loadingMessages[messageIndex]}
        </p>
      </div>
    </div>
  );
}

function StartPaperDeckButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      className="h-11 w-full rounded-lg bg-teal-300 text-sm font-black text-zinc-950 transition-colors hover:bg-teal-200 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
      disabled={disabled || pending}
    >
      Start PaperDeck
    </button>
  );
}

function SkipOnboardingButton() {
  const { pending } = useFormStatus();

  return (
    <button
      className="h-10 w-full rounded-lg text-sm font-black text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200 disabled:cursor-not-allowed disabled:text-zinc-700 disabled:hover:bg-transparent"
      disabled={pending}
      formAction={skipOnboardingAction}
    >
      Not now
    </button>
  );
}

export function OnboardingTopicPicker({
  devAuthEnabled = false,
  initialDisplayName = "",
  topics,
}: OnboardingTopicPickerProps) {
  const topicsById = useMemo(
    () => new Map(topics.map((topic) => [topic.id, topic])),
    [topics],
  );
  const [stepIndex, setStepIndex] = useState(0);
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [activeMacroIds, setActiveMacroIds] = useState(
    () => new Set<string>(),
  );
  const [selectedTopicIds, setSelectedTopicIds] = useState(
    () => new Set<string>(),
  );

  const macroTopics = topics.filter((topic) => topicGranularity(topic) === "macro");
  const standardMacroGroups = topicMacroGroups.filter(
    (macro) => macro.id !== "other-cs",
  );
  const otherMacroGroups = topicMacroGroups.filter(
    (macro) => macro.id === "other-cs",
  );
  const macroChoices = [
    ...standardMacroGroups.map((macro) => ({ kind: "group" as const, value: macro })),
    ...macroTopics.map((topic) => ({ kind: "topic" as const, value: topic })),
    ...otherMacroGroups.map((macro) => ({ kind: "group" as const, value: macro })),
  ];
  const categoryTopics = topics.filter(
    (topic) =>
      topicGranularity(topic) === "category" &&
      topicMatchesMacro(topic, activeMacroIds),
  );
  const selectedCategoryTopics = categoryTopics.filter((topic) =>
    selectedTopicIds.has(topic.id),
  );
  const selectedCategoryIds = new Set(
    selectedCategoryTopics.map((topic) => topic.id),
  );
  const selectedCategoryArxivCodes = new Set(
    selectedCategoryTopics
      .map((topic) => topic.arxivCategory)
      .filter((category): category is string => Boolean(category)),
  );
  const microTopics = topics.filter((topic) => {
    if (topicGranularity(topic) !== "micro") {
      return false;
    }

    if (topic.parentId && selectedCategoryIds.has(topic.parentId)) {
      return true;
    }

    if (
      topic.arxivCategory &&
      selectedCategoryArxivCodes.has(topic.arxivCategory)
    ) {
      return true;
    }

    return topicMatchesMacro(topic, activeMacroIds);
  });
  const selectedMacroTopicCount = macroTopics.filter((topic) =>
    selectedTopicIds.has(topic.id),
  ).length;
  const canGoNext =
    stepIndex === 0
      ? [...normalizePublicDisplayName(displayName)].length >= 2 &&
        [...normalizePublicDisplayName(displayName)].length <= 50
      : stepIndex === 1
        ? activeMacroIds.size + selectedMacroTopicCount > 0
        : selectedCategoryTopics.length > 0 || selectedMacroTopicCount > 0;
  const currentTitle =
    stepIndex === 0
      ? "Your public name"
    : stepIndex === 1
      ? "Macro areas"
      : stepIndex === 2
        ? "Categories"
        : "Microcategories";
  const currentOptions =
    stepIndex === 0
      ? "profile"
    : stepIndex === 1
      ? "macro"
      : stepIndex === 2
        ? "category"
        : "micro";

  function toggleMacro(macroId: string) {
    const nextMacroIds = new Set(activeMacroIds);

    if (nextMacroIds.has(macroId)) {
      nextMacroIds.delete(macroId);
    } else {
      nextMacroIds.add(macroId);
    }

    setActiveMacroIds(nextMacroIds);
    setSelectedTopicIds((current) => {
      const nextSelected = [...current].filter((topicId) => {
        const topic = topicsById.get(topicId);

        if (!topic) {
          return false;
        }

        return topicGranularity(topic) === "macro" || topicMatchesMacro(topic, nextMacroIds);
      });

      return new Set(nextSelected);
    });
  }

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
      className="min-h-screen bg-[#151515] text-zinc-50"
    >
      {[...selectedTopicIds].map((topicId) => (
        <input key={topicId} name="topicId" type="hidden" value={topicId} />
      ))}
      <input name="displayName" type="hidden" value={displayName} />
      <OnboardingLoadingOverlay />

      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 py-5 sm:px-8">
        <header
          className="flex h-12 items-center justify-between"
          role="banner"
        >
          <div>
            <p className="text-sm font-black tracking-normal text-zinc-100">
              PaperDeck
            </p>
            <h1 className="sr-only">Topics</h1>
          </div>
          {devAuthEnabled ? (
            <div className="h-9 rounded-lg border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs font-black text-amber-200">
              Local dev
            </div>
          ) : null}
        </header>

        <div className="flex flex-1 items-center py-8">
          <div className="grid w-full gap-7 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-start">
            <section>
              <div className="flex items-center gap-2">
                {steps.map((step, index) => (
                  <div
                    key={step}
                    aria-current={index === stepIndex ? "step" : undefined}
                    className={`h-1.5 flex-1 rounded-full ${
                      index <= stepIndex ? "bg-teal-300" : "bg-zinc-800"
                    }`}
                  />
                ))}
              </div>

              <div className="mt-7">
                <div>
                  <p className="text-xs font-black uppercase tracking-normal text-zinc-500 lg:text-sm">
                    Step {stepIndex + 1} of {steps.length}
                  </p>
                  <h2 className="mt-2 text-3xl font-black tracking-normal text-zinc-50 lg:text-4xl">
                    {currentTitle}
                  </h2>
                </div>
              </div>

              {currentOptions === "profile" ? (
                <div className="mt-7 max-w-xl">
                  <label className="block text-sm font-black text-zinc-200">
                    Public display name
                    <input
                      autoComplete="name"
                      autoFocus
                      className="mt-3 h-12 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 text-base font-bold text-zinc-50 outline-none transition focus:border-teal-300 focus:ring-2 focus:ring-teal-300/20"
                      maxLength={50}
                      minLength={2}
                      placeholder="Ada Lovelace"
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                    />
                  </label>
                  <p className="mt-3 text-sm font-semibold leading-6 text-zinc-500">
                    People who find you by your exact email will see this name.
                    Your email always stays private.
                  </p>
                </div>
              ) : null}

              {currentOptions === "macro" ? (
                <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {macroChoices.map((choice) => {
                    const isSelected =
                      choice.kind === "group"
                        ? activeMacroIds.has(choice.value.id)
                        : selectedTopicIds.has(choice.value.id);

                    return (
                      <button
                        key={choice.value.id}
                        className={optionButtonClass(isSelected)}
                        type="button"
                        onClick={() =>
                          choice.kind === "group"
                            ? toggleMacro(choice.value.id)
                            : toggleTopic(choice.value.id)
                        }
                      >
                        <span>{choice.value.label}</span>
                        {isSelected ? (
                          <Check aria-hidden="true" size={18} strokeWidth={2.5} />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {currentOptions === "category" ? (
                <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {categoryTopics.map((topic) => {
                    const isSelected = selectedTopicIds.has(topic.id);

                    return (
                      <button
                        key={topic.id}
                        className={optionButtonClass(isSelected)}
                        type="button"
                        onClick={() => toggleTopic(topic.id)}
                      >
                        <span>{topic.label}</span>
                        {isSelected ? (
                          <Check aria-hidden="true" size={18} strokeWidth={2.5} />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {currentOptions === "micro" ? (
                <div className="mt-7 flex flex-wrap gap-2">
                  {microTopics.length ? (
                    microTopics.map((topic) => {
                      const isSelected = selectedTopicIds.has(topic.id);

                      return (
                        <button
                          key={topic.id}
                          className={chipButtonClass(isSelected)}
                          type="button"
                          onClick={() => toggleTopic(topic.id)}
                        >
                          {topic.label}
                        </button>
                      );
                    })
                  ) : (
                    <p className="text-sm font-bold text-zinc-500">
                      No microcategories available.
                    </p>
                  )}
                </div>
              ) : null}
            </section>

            <div className="grid gap-2 border-t border-zinc-800 pt-5 lg:sticky lg:top-8 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
              {stepIndex < steps.length - 1 ? (
                <button
                  className="h-11 w-full rounded-lg bg-teal-300 text-sm font-black text-zinc-950 transition-colors hover:bg-teal-200 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
                  disabled={!canGoNext}
                  type="button"
                  onClick={() => setStepIndex((current) => current + 1)}
                >
                  Next
                </button>
              ) : (
                <StartPaperDeckButton disabled={!selectedTopicIds.size} />
              )}

              {stepIndex > 0 ? (
                <button
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-zinc-800 bg-transparent text-sm font-black text-zinc-300 transition-colors hover:bg-zinc-900"
                  type="button"
                  onClick={() => setStepIndex((current) => current - 1)}
                >
                  <ArrowLeft aria-hidden="true" size={16} strokeWidth={2.5} />
                  Back
                </button>
              ) : null}

              <SkipOnboardingButton />
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
