"use client";

import { useRef } from "react";
import { useFormStatus } from "react-dom";
import { NotebookPen, Send, Trash2 } from "lucide-react";
import { MathContent } from "@/components/math-content";

type PaperNote = {
  id: string;
  body: string;
  createdAt: string;
};

type PaperNoteEditorProps = {
  paperId: string;
  notes: PaperNote[];
  maxLength: number;
  addAction: (formData: FormData) => Promise<void>;
  deleteAction: (formData: FormData) => Promise<void>;
};

function AddButton() {
  const { pending } = useFormStatus();

  return (
    <button
      className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-black text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.99]"
      disabled={pending}
      type="submit"
    >
      <Send aria-hidden="true" size={16} strokeWidth={2.5} />
      {pending ? "Adding..." : "Add note"}
    </button>
  );
}

function formatCreatedAt(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function AddNoteForm({
  paperId,
  maxLength,
  addAction,
}: {
  paperId: string;
  maxLength: number;
  addAction: (formData: FormData) => Promise<void>;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      action={async (formData) => {
        await addAction(formData);
        formRef.current?.reset();
      }}
      className="mt-4"
      ref={formRef}
    >
      <input name="paperId" type="hidden" value={paperId} />
      <textarea
        className="min-h-24 w-full rounded-lg border border-slate-200 bg-white p-3 text-sm font-medium leading-6 text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
        maxLength={maxLength}
        name="body"
        placeholder="Write a note and add it to the log..."
        required
      />
      <div className="mt-2 flex items-center justify-end">
        <AddButton />
      </div>
    </form>
  );
}

export function PaperNoteEditor({
  paperId,
  notes,
  maxLength,
  addAction,
  deleteAction,
}: PaperNoteEditorProps) {
  return (
    <section className="mt-8 border-t border-slate-200 pt-6">
      <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-normal text-slate-500">
        <NotebookPen aria-hidden="true" size={16} strokeWidth={2.5} />
        Private notes
      </h2>

      <p className="mt-1.5 text-xs font-semibold leading-5 text-slate-500">
        Only you can see these. Each note is saved to a timestamped log.
      </p>

      <AddNoteForm
        addAction={addAction}
        maxLength={maxLength}
        paperId={paperId}
      />

      {notes.length ? (
        <ol className="mt-6 space-y-3">
          {notes.map((note) => (
            <li
              key={note.id}
              className="rounded-lg border border-slate-200 bg-slate-50 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <time className="text-xs font-black uppercase tracking-normal text-slate-400">
                  {formatCreatedAt(note.createdAt)}
                </time>
                <form action={deleteAction}>
                  <input name="paperId" type="hidden" value={paperId} />
                  <input name="noteId" type="hidden" value={note.id} />
                  <button
                    aria-label="Delete note"
                    className="grid h-8 w-8 place-items-center rounded-md text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 active:scale-[0.97]"
                    type="submit"
                  >
                    <Trash2 aria-hidden="true" size={15} strokeWidth={2.5} />
                  </button>
                </form>
              </div>
              <div className="mt-2 whitespace-pre-wrap text-sm font-medium leading-6 text-slate-700">
                <MathContent text={note.body} />
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-6 rounded-lg border border-dashed border-slate-200 bg-white p-4 text-center text-xs font-semibold text-slate-400">
          No notes yet. Add your first one above.
        </p>
      )}
    </section>
  );
}
