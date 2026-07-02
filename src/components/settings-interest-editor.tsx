"use client";

import { useState, useCallback } from "react";
import { Check, X } from "lucide-react";
import { saveSettingsInterestsAction } from "@/app/actions";

type InterestRow = {
  id: string;
  label: string;
  depth: number;
  selected: boolean;
};

type Props = {
  interests: InterestRow[];
};

export function SettingsInterestEditor({ interests }: Props) {
  const [selectedIds, setSelectedIds] = useState(
    () => new Set(interests.filter((i) => i.selected).map((i) => i.id)),
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const toggle = useCallback(
    (id: string) => {
      const next = new Set(selectedIds);
      if (next.has(id)) {
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

  const root = interests.filter((i) => i.depth <= 1);
  const leaf = interests.filter((i) => i.depth > 1);

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

      <div className="mt-4 space-y-4">
        <div>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-normal text-slate-400">
            Broad areas
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {root.map((topic) => {
              const isSelected = selectedIds.has(topic.id);
              return (
                <button
                  key={topic.id}
                  type="button"
                  onClick={() => toggle(topic.id)}
                  className={`flex items-center justify-between gap-2 rounded-lg border px-4 py-3 text-left text-sm font-bold transition-colors ${
                    isSelected
                      ? "border-teal-300 bg-teal-50 text-teal-950"
                      : "border-slate-200 bg-white text-slate-700 hover:border-indigo-200 hover:bg-indigo-50"
                  }`}
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
            Refine topics
          </h3>
          <div className="flex flex-wrap gap-2">
            {leaf.map((topic) => {
              const isSelected = selectedIds.has(topic.id);
              return (
                <button
                  key={topic.id}
                  type="button"
                  onClick={() => toggle(topic.id)}
                  className={`rounded-lg border px-3 py-2 text-sm font-bold transition-colors ${
                    isSelected
                      ? "border-teal-300 bg-teal-50 text-teal-900"
                      : "border-slate-200 bg-white text-slate-700 hover:border-indigo-200 hover:bg-indigo-50"
                  }`}
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
