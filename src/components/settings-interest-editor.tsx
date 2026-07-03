"use client";

import { useCallback, useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import { saveSettingsInterestsAction } from "@/app/actions";
import {
  macroIdsFromTopics,
  topicGranularity,
  topicMacroGroupIds,
  topicMacroGroups,
  topicMatchesMacro,
} from "@/lib/topic-taxonomy";

type InterestRow = {
  arxivCategory: string | null;
  depth: number;
  id: string;
  label: string;
  parentId: string | null;
  selected: boolean;
  slug: string;
  source: string | null;
};

type Props = {
  interests: InterestRow[];
};

function topicButtonClass(isSelected: boolean) {
  return `flex items-center justify-between gap-2 rounded-lg border px-4 py-3 text-left text-sm font-bold transition-colors ${
    isSelected
      ? "border-teal-300 bg-teal-50 text-teal-950"
      : "border-slate-200 bg-white text-slate-700 hover:border-indigo-200 hover:bg-indigo-50"
  }`;
}

function guardedTopicButtonClass(isSelected: boolean, isDisabled: boolean) {
  return `${topicButtonClass(isSelected)} ${
    isDisabled ? "cursor-not-allowed opacity-60" : ""
  }`;
}

function chipButtonClass(isSelected: boolean) {
  return `rounded-lg border px-3 py-2 text-sm font-bold transition-colors ${
    isSelected
      ? "border-teal-300 bg-teal-50 text-teal-900"
      : "border-slate-200 bg-white text-slate-700 hover:border-indigo-200 hover:bg-indigo-50"
  }`;
}

function guardedChipButtonClass(isSelected: boolean, isDisabled: boolean) {
  return `${chipButtonClass(isSelected)} ${
    isDisabled ? "cursor-not-allowed opacity-60" : ""
  }`;
}

export function SettingsInterestEditor({ interests }: Props) {
  const initiallySelectedInterests = useMemo(
    () => interests.filter((interest) => interest.selected),
    [interests],
  );
  const [activeMacroIds, setActiveMacroIds] = useState(
    () => {
      const macroIds = macroIdsFromTopics(initiallySelectedInterests);

      return new Set(macroIds.length ? macroIds : topicMacroGroupIds);
    },
  );
  const [selectedIds, setSelectedIds] = useState(
    () => new Set(initiallySelectedInterests.map((interest) => interest.id)),
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const macroTopics = interests.filter(
    (interest) => topicGranularity(interest) === "macro",
  );
  const categoryTopics = interests.filter(
    (interest) =>
      topicGranularity(interest) === "category" &&
      topicMatchesMacro(interest, activeMacroIds),
  );
  const selectedCategoryTopics = categoryTopics.filter((interest) =>
    selectedIds.has(interest.id),
  );
  const selectedCategoryIds = new Set(
    selectedCategoryTopics.map((interest) => interest.id),
  );
  const selectedCategoryArxivCodes = new Set(
    selectedCategoryTopics
      .map((interest) => interest.arxivCategory)
      .filter((category): category is string => Boolean(category)),
  );
  const microTopics = interests.filter((interest) => {
    if (topicGranularity(interest) !== "micro") {
      return false;
    }

    if (interest.parentId && selectedCategoryIds.has(interest.parentId)) {
      return true;
    }

    if (
      interest.arxivCategory &&
      selectedCategoryArxivCodes.has(interest.arxivCategory)
    ) {
      return true;
    }

    return topicMatchesMacro(interest, activeMacroIds);
  });

  function toggleMacro(macroId: string) {
    setActiveMacroIds((current) => {
      const next = new Set(current);

      if (next.has(macroId)) {
        if (next.size <= 1) {
          return current;
        }

        next.delete(macroId);
      } else {
        next.add(macroId);
      }

      return next;
    });
  }

  const toggle = useCallback(
    (id: string) => {
      const next = new Set(selectedIds);

      if (next.has(id)) {
        if (next.size <= 1) {
          return;
        }

        next.delete(id);
      } else {
        next.add(id);
      }
      setSelectedIds(next);
      setSaved(false);
      setSaving(true);

      saveSettingsInterestsAction(Array.from(next))
        .then(() => {
          setSaving(false);
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        })
        .catch(() => {
          setSaving(false);
        });
    },
    [selectedIds],
  );

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-black uppercase tracking-normal text-slate-500">
          Interests
        </h2>
        <div className="flex items-center gap-2">
          {saving ? (
            <span className="text-xs font-bold text-slate-400">Saving...</span>
          ) : saved ? (
            <span className="flex items-center gap-1 text-xs font-bold text-emerald-600">
              <Check size={14} strokeWidth={3} />
              Saved
            </span>
          ) : null}
          {selectedIds.size > 0 ? (
            <span className="text-xs font-bold text-slate-400">
              {selectedIds.size} selected
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-4 space-y-5">
        <div>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-normal text-slate-400">
            Macro areas
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {topicMacroGroups.map((macro) => {
              const isSelected = activeMacroIds.has(macro.id);
              const isDisabled = isSelected && activeMacroIds.size <= 1;

              return (
                <button
                  key={macro.id}
                  disabled={isDisabled}
                  type="button"
                  onClick={() => toggleMacro(macro.id)}
                  className={guardedTopicButtonClass(isSelected, isDisabled)}
                >
                  <span>
                    <span className="block font-black">{macro.label}</span>
                    <span className="mt-1 block text-xs font-semibold leading-5 text-slate-500">
                      {macro.description}
                    </span>
                  </span>
                  {isSelected ? (
                    <X
                      size={16}
                      strokeWidth={2.5}
                      className="shrink-0 text-teal-500"
                    />
                  ) : null}
                </button>
              );
            })}
            {macroTopics.map((topic) => {
              const isSelected = selectedIds.has(topic.id);
              const isDisabled = isSelected && selectedIds.size <= 1;

              return (
                <button
                  key={topic.id}
                  disabled={isDisabled}
                  type="button"
                  onClick={() => toggle(topic.id)}
                  className={guardedTopicButtonClass(isSelected, isDisabled)}
                >
                  {topic.label}
                  {isSelected ? (
                    <X
                      size={16}
                      strokeWidth={2.5}
                      className="shrink-0 text-teal-500"
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-normal text-slate-400">
            Categories
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {categoryTopics.map((topic) => {
              const isSelected = selectedIds.has(topic.id);
              const isDisabled = isSelected && selectedIds.size <= 1;

              return (
                <button
                  key={topic.id}
                  disabled={isDisabled}
                  type="button"
                  onClick={() => toggle(topic.id)}
                  className={guardedTopicButtonClass(isSelected, isDisabled)}
                >
                  {topic.label}
                  {isSelected ? (
                    <X
                      size={16}
                      strokeWidth={2.5}
                      className="shrink-0 text-teal-500"
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-normal text-slate-400">
            Microcategories
          </h3>
          <div className="flex flex-wrap gap-2">
            {microTopics.map((topic) => {
              const isSelected = selectedIds.has(topic.id);
              const isDisabled = isSelected && selectedIds.size <= 1;

              return (
                <button
                  key={topic.id}
                  disabled={isDisabled}
                  type="button"
                  onClick={() => toggle(topic.id)}
                  className={guardedChipButtonClass(isSelected, isDisabled)}
                >
                  {topic.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
