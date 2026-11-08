"use client";

import React from "react";
import { cn } from "@/lib/cn";
import { ChevronDown } from "./icons";
import { FOCUS_RING } from "./button";

interface ExpandableRowProps {
    open: boolean;
    onToggle: () => void;
    /** Collapsed summary; the whole area is the toggle button. */
    summary: React.ReactNode;
    /** Interactive controls (switches, forms) rendered outside the toggle button. */
    controls?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
    /** Element id for aria-controls. */
    id: string;
    muted?: boolean;
    as?: "li" | "div";
    /** Rendered before the toggle button, outside it (e.g. a drag handle). */
    leading?: React.ReactNode;
    /** For sortable lists: the row element and its transform style. */
    rowRef?: React.Ref<HTMLLIElement & HTMLDivElement>;
    style?: React.CSSProperties;
}

/** A list row whose header toggles a body. Controls are siblings of the button, never inside it. */
export function ExpandableRow({ open, onToggle, summary, controls, children, className, id, muted, as: Tag = "li", leading, rowRef, style }: ExpandableRowProps) {
    const bodyId = `${id}-body`;
    return (
        <Tag ref={rowRef} style={style} className={cn("group/row bg-surface transition-colors", open && "bg-surface", className)}>
            <div className="flex min-h-[52px] items-stretch">
                {leading && <div className="flex shrink-0 items-center pl-2">{leading}</div>}
                <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={bodyId}
                    onClick={onToggle}
                    className={cn("flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 pr-2 text-left", FOCUS_RING, "focus-visible:ring-inset focus-visible:ring-offset-0")}
                >
                    <ChevronDown className={cn("size-4 shrink-0 text-fg-subtle transition-transform duration-[240ms] ease-in-out", open && "rotate-180")} aria-hidden />
                    <div className={cn("min-w-0 flex-1", muted && "opacity-60")}>{summary}</div>
                </button>
                {controls && <div className="flex shrink-0 items-center gap-2 pr-4 pl-1">{controls}</div>}
            </div>
            {/* Details settle: revealed top-down through a mask, children arriving 30 ms apart. */}
            <div id={bodyId} hidden={!open} className="pb-4 pl-11 pr-4">
                {open && <div className="settle">{children}</div>}
            </div>
        </Tag>
    );
}
