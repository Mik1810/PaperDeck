"use client";

import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { BookmarkX, GripVertical } from "lucide-react";
import { MathContent } from "@/components/math-content";
import type { Paper } from "@/types/paper";

type Props = {
  paper: Paper;
  playlistId: string;
  removeAction: (formData: FormData) => Promise<void>;
  reorderDisabled?: boolean;
};

export function SortablePlaylistPaper({
  paper,
  playlistId,
  removeAction,
  reorderDisabled = false,
}: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ disabled: reorderDisabled, id: paper.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-2 shadow-sm transition hover:border-slate-300 hover:shadow-md"
    >
      <button
        className="mr-2 cursor-grab touch-none rounded p-0.5 text-slate-300 hover:text-slate-500 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
        {...attributes}
        {...listeners}
        aria-label={
          reorderDisabled ? "Load all papers to reorder" : "Drag to reorder"
        }
        disabled={reorderDisabled}
        type="button"
      >
        <GripVertical aria-hidden="true" size={16} strokeWidth={2} />
      </button>

      <Link
        className="min-w-0 flex-1 rounded-lg px-2 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
        href={`/papers/${paper.id}`}
      >
        <span className="text-sm font-bold text-slate-900 hover:text-teal-700">
          <MathContent text={paper.title} />
        </span>
        <p className="mt-0.5 truncate text-xs font-semibold text-slate-500">
          {paper.authors.join(", ")}
          {paper.year ? ` - ${paper.year}` : ""}
        </p>
      </Link>

      <form action={removeAction}>
        <input name="playlistId" type="hidden" value={playlistId} />
        <input name="paperId" type="hidden" value={paper.id} />
        <button
          aria-label="Remove from playlist"
          className="ml-2 rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
          type="submit"
        >
          <BookmarkX aria-hidden="true" size={16} strokeWidth={2.4} />
        </button>
      </form>
    </div>
  );
}
