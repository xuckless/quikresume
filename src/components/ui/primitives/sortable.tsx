"use client";

// Vertical drag-to-reorder built on @dnd-kit. Rows opt in with useSortableRow,
// which returns the row ref / transform style and a DragHandle. Only the
// handle starts a drag (pointer after 4px, or Space/Enter + arrow keys), so
// clicks on row toggles and inputs are unaffected.
//
// Motion: the held row follows the pointer 1:1 (no transition while dragging), locked to the vertical axis;
// past the first / last row it gives way like rubber (`rubberBand`) and eases back on release. Rows making
// room, and the dropped row settling into its slot, move ease-in-out (`DUR.move`).

import React, { useId } from "react";
import {
    closestCenter, DndContext, KeyboardSensor, MeasuringStrategy, PointerSensor, useSensor, useSensors,
    type Announcements, type DragEndEvent, type DragStartEvent, type Modifier,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/cn";
import { CSS_EASE, DUR, rubberBand } from "@/lib/ui/motion";
import { FOCUS_RING } from "./button";
import { GripVertical } from "./icons";

/** Vertical only, and rubber-banded past the list's own box (the row's parent element). */
const rubberBandInList: Modifier = ({ transform, draggingNodeRect, containerNodeRect }) => {
    if (!draggingNodeRect || !containerNodeRect) return { ...transform, x: 0 };
    const min = containerNodeRect.top - draggingNodeRect.top;
    const max = containerNodeRect.bottom - draggingNodeRect.bottom;
    // A row taller than its list (e.g. while other rows collapse) has no room to give: leave it free.
    if (min > max) return { ...transform, x: 0 };
    const y = transform.y < min ? min - rubberBand(min - transform.y) : transform.y > max ? max + rubberBand(transform.y - max) : transform.y;
    return { ...transform, x: 0, y };
};
const MODIFIERS = [rubberBandInList];

export function SortableList({ ids, onMove, onDragStart, onDragDone, labelOf, children }: {
    ids: string[];
    /** Called once on drop when the position changed. */
    onMove: (activeId: string, overId: string) => void;
    onDragStart?: (id: string) => void;
    /** Drop or cancel. */
    onDragDone?: () => void;
    /** Human name of a row for screen-reader announcements. */
    labelOf: (id: string) => string;
    children: React.ReactNode;
}) {
    const contextId = useId();
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );
    const position = (id: string | number) => ids.indexOf(String(id)) + 1;
    const announcements: Announcements = {
        onDragStart: ({ active }) => `Picked up ${labelOf(String(active.id))}. Position ${position(active.id)} of ${ids.length}.`,
        onDragOver: ({ active, over }) => (over ? `${labelOf(String(active.id))} moved to position ${position(over.id)} of ${ids.length}.` : undefined),
        onDragEnd: ({ active, over }) => (over ? `${labelOf(String(active.id))} dropped at position ${position(over.id)} of ${ids.length}.` : `${labelOf(String(active.id))} dropped.`),
        onDragCancel: ({ active }) => `Moving ${labelOf(String(active.id))} was cancelled.`,
    };
    const end = ({ active, over }: DragEndEvent) => {
        onDragDone?.();
        if (over && active.id !== over.id) onMove(String(active.id), String(over.id));
    };
    return (
        <DndContext
            id={contextId}
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={MODIFIERS}
            // Rows can change height mid-drag (sections collapse to their headers), so keep re-measuring.
            measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
            onDragStart={({ active }: DragStartEvent) => onDragStart?.(String(active.id))}
            onDragEnd={end}
            onDragCancel={() => onDragDone?.()}
            accessibility={{ announcements, screenReaderInstructions: { draggable: "To reorder, press Space or Enter, move with the arrow keys, then press Space or Enter again to drop. Escape cancels." } }}
        >
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>{children}</SortableContext>
        </DndContext>
    );
}

export function useSortableRow(id: string, label: string, disabled = false) {
    // Rows making room move ease-in-out; the held row follows the pointer with no easing at all.
    const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
        id, disabled, transition: { duration: DUR.move, easing: CSS_EASE.inOut },
    });
    const style: React.CSSProperties = {
        transform: CSS.Translate.toString(transform),
        transition: isDragging ? undefined : transition,
        position: "relative",
        zIndex: isDragging ? 10 : undefined,
    };
    const handle = disabled ? null : (
        <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`Drag to reorder ${label}`}
            className={cn("press flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-fg-subtle hover:bg-surface-muted hover:text-fg active:cursor-grabbing", FOCUS_RING)}
        >
            <GripVertical className="size-4" aria-hidden />
        </button>
    );
    return { rowRef: setNodeRef, style, handle, isDragging };
}
