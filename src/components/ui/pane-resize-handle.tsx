"use client";

// Vertical splitter on the left edge of the preview pane. Dragging updates a
// local width every animation frame and commits to the persisted store on
// release, so localStorage is written once per drag.

import React, { useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { DUR, rubberBand } from "@/lib/ui/motion";
import { PANE_DEFAULT, PANE_MIN, setPreviewPaneWidth } from "@/lib/ui/preview-pane-store";

interface PaneResizeHandleProps {
    /** The grid that holds content + pane; its right edge is the pane's right edge. */
    containerRef: React.RefObject<HTMLElement | null>;
    width: number;
    /** Live width while dragging (null when idle). `settle` asks the layout to ease to it (after release). */
    onDrag: (px: number | null, settle?: boolean) => void;
}

const STEP = 16;
const BIG_STEP = 64;

export function PaneResizeHandle({ containerRef, width, onDrag }: PaneResizeHandleProps) {
    const [dragging, setDragging] = useState(false);
    const frame = useRef(0);
    const latest = useRef(width);

    const maxWidth = () => Math.max(PANE_MIN, (containerRef.current?.getBoundingClientRect().width ?? PANE_MIN * 2) / 2);
    const clamp = (px: number) => Math.min(maxWidth(), Math.max(PANE_MIN, px));

    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        latest.current = clamp(width);
        setDragging(true);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
    };

    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!dragging) return;
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        // Follow the pointer 1:1 while held (no easing); beyond the limits, rubber-band.
        const raw = rect.right - e.clientX;
        latest.current = clamp(raw);
        const max = maxWidth();
        const shown = raw > max ? max + rubberBand(raw - max) : raw < PANE_MIN ? PANE_MIN - rubberBand(PANE_MIN - raw) : raw;
        cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() => onDrag(shown));
    };

    const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!dragging) return;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        cancelAnimationFrame(frame.current);
        setDragging(false);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setPreviewPaneWidth(latest.current);
        // Released past a limit: ease back to it, then hand the width back to the stored value.
        const target = latest.current;
        onDrag(target, true);
        window.setTimeout(() => onDrag(null), DUR.move);
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        const step = e.shiftKey ? BIG_STEP : STEP;
        const current = clamp(width);
        let next: number | null = null;
        // The pane sits on the right, so moving the handle left widens it.
        if (e.key === "ArrowLeft") next = current + step;
        else if (e.key === "ArrowRight") next = current - step;
        else if (e.key === "Home") next = PANE_MIN;
        else if (e.key === "End") next = maxWidth();
        if (next === null) return;
        e.preventDefault();
        setPreviewPaneWidth(clamp(next));
    };

    return (
        <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize preview"
            aria-valuemin={PANE_MIN}
            aria-valuenow={Math.round(width)}
            tabIndex={0}
            title="Drag to resize · double-click to reset"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onDoubleClick={() => setPreviewPaneWidth(PANE_DEFAULT)}
            onKeyDown={onKeyDown}
            className="group absolute inset-y-0 left-0 z-10 w-2 -translate-x-1/2 cursor-col-resize touch-none outline-none"
        >
            <span
                aria-hidden
                className={cn(
                    "absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors",
                    dragging ? "w-0.5 bg-accent" : "bg-transparent group-hover:bg-border-strong group-focus-visible:w-0.5 group-focus-visible:bg-accent",
                )}
            />
        </div>
    );
}
