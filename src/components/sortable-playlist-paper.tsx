"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { BookmarkX, GripVertical } from "lucide-react";
import { removeFromPlaylistAction } from "@/app/actions";
import type { Paper } from "@/types/paper";

type Props = {
  paper: Paper;
  playlistId: string;
};

export function SortablePlaylistPaper({ paper, playlistId }: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: paper.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3"
    >
      <button
        className="mr-2 cursor-grab touch-none rounded p-0.5 text-slate-300 hover:text-slate-500 active:cursor-grabbing"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        type="button"
      >
        <GripVertical aria-hidden="true" size={16} strokeWidth={2} />
      </button>

      <div className="min-w-0 flex-1">
        <a
          className="text-sm font-bold text-slate-900 hover:text-teal-700"
          href={`/papers/${paper.id}`}
        >
          {paper.title}
        </a>
        <p className="mt-0.5 truncate text-xs font-semibold text-slate-500">
          {paper.authors.join(", ")} - {paper.year}
        </p>
      </div>

      <form action={removeFromPlaylistAction}>
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
