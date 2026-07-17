"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { saveCollaborationSettingsAction } from "@/app/actions";
import type {
  GroupInvitePolicy,
} from "@/lib/collaboration/profile";

type CollaborationSettingsEditorProps = {
  initialDisplayName: string;
  initialDiscoverableByEmail: boolean;
  initialGroupInvitePolicy: GroupInvitePolicy;
};

export function CollaborationSettingsEditor({
  initialDisplayName,
  initialDiscoverableByEmail,
  initialGroupInvitePolicy,
}: CollaborationSettingsEditorProps) {
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [discoverableByEmail, setDiscoverableByEmail] = useState(
    initialDiscoverableByEmail,
  );
  const [groupInvitePolicy, setGroupInvitePolicy] = useState(
    initialGroupInvitePolicy,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function save() {
    setMessage(null);
    startTransition(async () => {
      try {
        await saveCollaborationSettingsAction({
          displayName,
          discoverableByEmail,
          groupInvitePolicy,
        });
        setMessage("Collaboration settings saved.");
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Could not save settings.",
        );
      }
    });
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm md:p-5 lg:p-6">
      <h2 className="text-sm font-black uppercase tracking-normal text-slate-500 md:text-base">
        Public profile
      </h2>
      {!initialDisplayName ? (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold leading-5 text-amber-900">
          Add a public name before other people can find you.
        </p>
      ) : null}

      <label className="mt-4 block text-sm font-bold text-slate-700">
        Display name
        <input
          className="mt-2 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
          maxLength={50}
          minLength={2}
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </label>

      <label className="mt-4 flex items-start gap-3 rounded-lg bg-slate-100 p-3">
        <input
          checked={discoverableByEmail}
          className="mt-0.5 size-4 accent-teal-600"
          type="checkbox"
          onChange={(event) => setDiscoverableByEmail(event.target.checked)}
        />
        <span>
          <span className="block text-sm font-black text-slate-900">
            Find me by exact email
          </span>
          <span className="mt-1 block text-xs font-semibold leading-5 text-slate-500">
            Off by default. Turn this on only if you want people who already
            know your exact email to find this profile. Your email is never shown.
          </span>
        </span>
      </label>

      <label className="mt-4 block text-sm font-bold text-slate-700">
        Who may add me to groups
        <select
          className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
          value={groupInvitePolicy}
          onChange={(event) =>
            setGroupInvitePolicy(event.target.value as GroupInvitePolicy)
          }
        >
          <option value="nobody">Nobody</option>
          <option value="friends_only">Friends only</option>
          <option value="anyone">Anyone</option>
        </select>
      </label>

      <button
        className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-black text-white transition hover:bg-slate-800 disabled:cursor-wait disabled:bg-slate-500"
        disabled={isPending}
        type="button"
        onClick={save}
      >
        {isPending ? <Loader2 className="animate-spin" size={17} /> : null}
        Save profile
      </button>
      {message ? (
        <p aria-live="polite" className="mt-3 text-xs font-bold text-slate-600">
          {message}
        </p>
      ) : null}
    </section>
  );
}
