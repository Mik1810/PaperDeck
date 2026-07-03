"use client";

import { useRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { Layers } from "lucide-react";
import { reorderPlaylistAction } from "@/app/actions";
import { MutationAlert } from "@/components/mutation-alert";
import { SortablePlaylistPaper } from "@/components/sortable-playlist-paper";
import type { Paper } from "@/types/paper";

type Props = {
  playlistId: string;
  papers: Paper[];
};

export function PlaylistPapers({ playlistId, papers }: Props) {
  const [orderedPapers, setOrderedPapers] = useState(papers);
  const [reorderErrorMessage, setReorderErrorMessage] = useState<string | null>(
    null,
  );
  const reorderRequestId = useRef(0);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = orderedPapers.findIndex((p) => p.id === active.id);
    const newIndex = orderedPapers.findIndex((p) => p.id === over.id);

    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    const previousOrder = orderedPapers;
    const newOrder = arrayMove(orderedPapers, oldIndex, newIndex);
    const requestId = reorderRequestId.current + 1;
    reorderRequestId.current = requestId;

    setOrderedPapers(newOrder);
    setReorderErrorMessage(null);

    const formData = new FormData();
    formData.set("playlistId", playlistId);

    for (const paper of newOrder) {
      formData.append("paperId", paper.id);
    }

    try {
      await reorderPlaylistAction(formData);
    } catch {
      if (reorderRequestId.current === requestId) {
        setOrderedPapers(previousOrder);
        setReorderErrorMessage(
          "We could not save this playlist order. It has been restored.",
        );
      }
    }
  }

  if (!papers.length) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-white p-8 text-center">
        <Layers
          aria-hidden="true"
          size={28}
          strokeWidth={1.5}
          className="mx-auto text-slate-300"
        />
        <h3 className="mt-3 text-sm font-black text-slate-950">
          This playlist is empty
        </h3>
        <p className="mt-1.5 text-xs font-semibold leading-5 text-slate-500">
          Save papers from the deck and drag to reorder.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <MutationAlert message={reorderErrorMessage} />
      <DndContext
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        sensors={sensors}
      >
        <SortableContext
          items={orderedPapers.map((p) => p.id)}
          strategy={verticalListSortingStrategy}
        >
          {orderedPapers.map((paper) => (
            <SortablePlaylistPaper
              key={paper.id}
              paper={paper}
              playlistId={playlistId}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}
