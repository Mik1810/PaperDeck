"use client";

import { useState } from "react";
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
import { reorderPlaylistAction } from "@/app/actions";
import { SortablePlaylistPaper } from "@/components/sortable-playlist-paper";
import type { Paper } from "@/types/paper";

type Props = {
  playlistId: string;
  papers: Paper[];
};

export function PlaylistPapers({ playlistId, papers }: Props) {
  const [orderedPapers, setOrderedPapers] = useState(papers);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = orderedPapers.findIndex((p) => p.id === active.id);
    const newIndex = orderedPapers.findIndex((p) => p.id === over.id);

    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    const newOrder = arrayMove(orderedPapers, oldIndex, newIndex);
    setOrderedPapers(newOrder);

    const formData = new FormData();
    formData.set("playlistId", playlistId);

    for (const paper of newOrder) {
      formData.append("paperId", paper.id);
    }

    reorderPlaylistAction(formData);
  }

  return (
    <div className="space-y-2">
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
