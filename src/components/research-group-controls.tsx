"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  Bell,
  Plus,
  Search,
  Trash2,
  UserMinus,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  addResearchGroupPaperAction,
  createResearchGroupAction,
  deleteResearchGroupAction,
  inviteResearchGroupMemberAction,
  leaveResearchGroupAction,
  removeResearchGroupMemberAction,
  removeResearchGroupPaperAction,
  respondResearchGroupInvitationAction,
  setGroupPaperNotificationPreferenceAction,
  setResearchGroupMemberRoleAction,
} from "@/app/groups/actions";
import { PaperListItem } from "@/components/paper-list-item";
import { PlaylistPicker } from "@/components/playlist-picker";
import type { ResearchGroupMemberSummary } from "@/lib/repositories/research-groups";
import type { ResearchGroupPaperNotificationPreference } from "@/lib/repositories/research-group-papers";
import type { Paper } from "@/types/paper";

function DialogBackdrop({
  children,
  label,
  onClose,
}: {
  children: ReactNode;
  label: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid items-end sm:place-items-center">
      <button
        type="button"
        aria-label={`Close ${label}`}
        className="absolute inset-0 bg-slate-950/45"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="relative z-10 max-h-[88vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:w-[min(92vw,42rem)] sm:rounded-xl"
      >
        {children}
      </section>
    </div>
  );
}

export function GroupCreateButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await createResearchGroupAction({
        name: String(data.get("name") ?? ""),
        description: String(data.get("description") ?? ""),
      });
      if (!result.ok || !result.groupId) {
        setError(result.message ?? "The group could not be created.");
        return;
      }
      setOpen(false);
      router.push(`/groups/${result.groupId}`);
    });
  }

  return (
    <>
      <button
        type="button"
        className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-black text-white hover:bg-slate-800"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <Plus aria-hidden="true" size={17} />
        New group
      </button>
      {open ? (
        <DialogBackdrop label="Create research group" onClose={() => setOpen(false)}>
          <form onSubmit={submit} className="p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-black text-slate-950">New research group</h2>
                <p className="mt-1 text-sm font-medium text-slate-500">
                  Start empty, then invite members and add catalog papers.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close create group dialog"
                className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
                onClick={() => setOpen(false)}
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <label className="mt-5 block text-sm font-black text-slate-700">
              Name
              <input
                name="name"
                required
                minLength={2}
                maxLength={80}
                className="mt-2 h-11 w-full rounded-lg border border-slate-200 px-3 font-semibold outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              />
            </label>
            <label className="mt-4 block text-sm font-black text-slate-700">
              Description <span className="font-semibold text-slate-400">optional</span>
              <textarea
                name="description"
                maxLength={500}
                rows={4}
                className="mt-2 w-full resize-none rounded-lg border border-slate-200 p-3 font-semibold outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              />
            </label>
            {error ? <p role="alert" className="mt-3 text-sm font-bold text-rose-700">{error}</p> : null}
            <button
              disabled={pending}
              className="mt-5 h-11 w-full rounded-lg bg-slate-950 px-4 text-sm font-black text-white disabled:opacity-60"
            >
              {pending ? "Creating…" : "Create group"}
            </button>
          </form>
        </DialogBackdrop>
      ) : null}
    </>
  );
}

export function GroupInvitationDecision({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function respond(accept: boolean) {
    startTransition(async () => {
      const result = await respondResearchGroupInvitationAction({ invitationId, accept });
      if (!result.ok) {
        setError(result.message ?? "The invitation is unavailable.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      <div className="flex gap-2">
        <button disabled={pending} onClick={() => respond(true)} className="h-9 rounded-lg bg-slate-950 px-3 text-xs font-black text-white disabled:opacity-60">Accept</button>
        <button disabled={pending} onClick={() => respond(false)} className="h-9 rounded-lg border border-slate-200 px-3 text-xs font-black text-slate-600 disabled:opacity-60">Decline</button>
      </div>
      {error ? <p role="alert" className="mt-2 text-xs font-bold text-rose-700">{error}</p> : null}
    </div>
  );
}

export function GroupPaperAddButton({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Paper[]>([]);
  const [addedIds, setAddedIds] = useState<Set<string>>(() => new Set());
  const [searching, setSearching] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = query.trim();
    if (!normalized) return;
    setSearching(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/groups/${groupId}/paper-search?q=${encodeURIComponent(normalized)}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("Search failed");
      const payload = (await response.json()) as { items: Paper[] };
      setItems(payload.items);
    } catch {
      setError("The catalog search could not be completed.");
    } finally {
      setSearching(false);
    }
  }

  async function add(paperId: string) {
    setPendingId(paperId);
    setError(null);
    const result = await addResearchGroupPaperAction({ groupId, paperId });
    if (result.ok) {
      setAddedIds((current) => new Set(current).add(paperId));
      router.refresh();
    } else {
      setError(result.message ?? "The paper could not be added.");
    }
    setPendingId(null);
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-black text-white hover:bg-slate-800">
        <Plus aria-hidden="true" size={17} /> Add paper
      </button>
      {open ? (
        <DialogBackdrop label="Add paper to group" onClose={() => setOpen(false)}>
          <div className="border-b border-slate-200 p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-black text-slate-950">Add a catalog paper</h2>
                <p className="mt-1 text-sm font-medium text-slate-500">Search PaperDeck without changing your private Library.</p>
              </div>
              <button type="button" aria-label="Close paper search" onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><X aria-hidden="true" size={18} /></button>
            </div>
            <form onSubmit={search} className="mt-4 flex gap-2">
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">Search catalog papers</span>
                <Search aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={120} type="search" placeholder="Title, author, topic, arXiv ID" className="h-11 w-full rounded-lg border border-slate-200 pl-10 pr-3 text-sm font-semibold outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200" />
              </label>
              <button disabled={searching || !query.trim()} className="h-11 rounded-lg bg-slate-950 px-4 text-sm font-black text-white disabled:opacity-60">{searching ? "Searching…" : "Search"}</button>
            </form>
            {error ? <p role="alert" className="mt-3 text-sm font-bold text-rose-700">{error}</p> : null}
          </div>
          <div className="space-y-3 p-4 sm:p-6">
            {items.map((paper) => {
              const added = addedIds.has(paper.id);
              return (
                <PaperListItem key={paper.id} paper={paper} action={
                  <button type="button" disabled={added || pendingId === paper.id} onClick={() => void add(paper.id)} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-black text-slate-700 disabled:bg-emerald-50 disabled:text-emerald-700">
                    {added ? "Added" : pendingId === paper.id ? "Adding…" : "Add to group"}
                  </button>
                } />
              );
            })}
            {!searching && query.trim() && !items.length ? <p className="py-8 text-center text-sm font-bold text-slate-500">No matching papers.</p> : null}
            {!query.trim() ? <p className="py-8 text-center text-sm font-bold text-slate-500">Search the catalog to choose a paper.</p> : null}
          </div>
        </DialogBackdrop>
      ) : null}
    </>
  );
}

export function GroupPaperActions({
  canRemove,
  groupId,
  paperId,
}: {
  canRemove: boolean;
  groupId: string;
  paperId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function remove() {
    startTransition(async () => {
      const result = await removeResearchGroupPaperAction({ groupId, paperId });
      if (!result.ok) {
        setError(result.message ?? "The paper could not be removed.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <PlaylistPicker context="group" initialSaved={false} paperId={paperId} variant="compact" savedLabel="Saved privately" unsavedLabel="Save privately" />
        {canRemove ? (
          <button type="button" disabled={pending} onClick={remove} className="inline-flex h-10 items-center gap-2 rounded-lg border border-rose-200 bg-white px-3 text-sm font-black text-rose-700 hover:bg-rose-50 disabled:opacity-60">
            <Trash2 aria-hidden="true" size={16} /> {pending ? "Removing…" : "Remove"}
          </button>
        ) : null}
      </div>
      {error ? <p role="alert" className="mt-2 text-xs font-bold text-rose-700">{error}</p> : null}
    </div>
  );
}

export function ResearchGroupManagement({
  groupId,
  members,
  preference,
  role,
}: {
  groupId: string;
  members: ResearchGroupMemberSummary[];
  preference: ResearchGroupPaperNotificationPreference;
  role: "owner" | "admin" | "member";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function run(task: () => Promise<{ ok: boolean; message?: string }>, onDone?: () => void) {
    setMessage(null);
    startTransition(async () => {
      const result = await task();
      if (!result.ok) {
        setMessage(result.message ?? "The group could not be updated.");
        return;
      }
      onDone?.();
      router.refresh();
    });
  }

  function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    run(
      () => inviteResearchGroupMemberAction({ groupId, email: String(data.get("email") ?? "") }),
      () => form.reset(),
    );
  }

  return (
    <aside className="space-y-4">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <Bell aria-hidden="true" size={17} className="text-slate-500" />
          <h2 className="text-sm font-black text-slate-950">Paper notifications</h2>
        </div>
        <select
          defaultValue={preference}
          disabled={pending}
          onChange={(event) => run(() => setGroupPaperNotificationPreferenceAction({ groupId, preference: event.target.value }))}
          className="mt-3 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700"
        >
          <option value="all">All activity</option>
          <option value="important_only">Important only</option>
          <option value="muted">Muted</option>
        </select>
      </section>

      {(role === "owner" || role === "admin") ? (
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-black text-slate-950">Invite member</h2>
          <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">Exact email only. The account must have opted in.</p>
          <form onSubmit={invite} className="mt-3 space-y-2">
            <input name="email" type="email" required autoComplete="off" placeholder="Exact email address" className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-slate-400" />
            <button disabled={pending} className="h-10 w-full rounded-lg bg-slate-950 text-sm font-black text-white disabled:opacity-60">Send invitation</button>
          </form>
        </section>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <Users aria-hidden="true" size={17} className="text-slate-500" />
          <h2 className="text-sm font-black text-slate-950">Members · {members.length}</h2>
        </div>
        <div className="mt-3 divide-y divide-slate-100">
          {members.map((member) => (
            <div key={member.publicId} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              {member.imageUrl ? <Image src={member.imageUrl} alt="" width={36} height={36} className="h-9 w-9 rounded-full object-cover" /> : <div className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-xs font-black text-slate-500">{member.displayName?.slice(0, 1).toUpperCase() || "?"}</div>}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black text-slate-900">{member.displayName || "Former member"}{member.isCurrentUser ? " · You" : ""}</p>
                <p className="text-xs font-bold capitalize text-slate-500">{member.role}</p>
              </div>
              {!member.isCurrentUser && role === "owner" && member.role !== "owner" ? (
                <button disabled={pending} onClick={() => run(() => setResearchGroupMemberRoleAction({ groupId, memberPublicId: member.publicId, role: member.role === "admin" ? "member" : "admin" }))} className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-black text-slate-600">{member.role === "admin" ? "Make member" : "Make admin"}</button>
              ) : null}
              {!member.isCurrentUser && member.role !== "owner" && (role === "owner" || role === "admin") ? (
                <button type="button" aria-label={`Remove ${member.displayName || "member"}`} disabled={pending} onClick={() => {
                  if (window.confirm("Remove this member from the group?")) run(() => removeResearchGroupMemberAction({ groupId, memberPublicId: member.publicId }));
                }} className="grid h-8 w-8 place-items-center rounded-lg text-rose-600 hover:bg-rose-50"><UserMinus aria-hidden="true" size={16} /></button>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        {role === "owner" ? (
          <button type="button" disabled={pending} onClick={() => {
            if (window.confirm("Delete this group and its shared list permanently?")) run(() => deleteResearchGroupAction(groupId), () => router.push("/groups"));
          }} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-rose-200 text-sm font-black text-rose-700 hover:bg-rose-50"><Trash2 aria-hidden="true" size={16} />Delete group</button>
        ) : (
          <button type="button" disabled={pending} onClick={() => {
            if (window.confirm("Leave this research group?")) run(() => leaveResearchGroupAction(groupId), () => router.push("/groups"));
          }} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-slate-200 text-sm font-black text-slate-700 hover:bg-slate-50"><UserMinus aria-hidden="true" size={16} />Leave group</button>
        )}
      </section>
      {message ? <p role="alert" className="text-sm font-bold text-rose-700">{message}</p> : null}
    </aside>
  );
}
