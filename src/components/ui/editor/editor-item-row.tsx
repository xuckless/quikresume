"use client";

import React, { useRef } from "react";
import { cn } from "@/lib/cn";
import { ExpandableRow } from "@/components/ui/primitives/expandable-row";
import { Switch } from "@/components/ui/primitives/switch";
import { IconButton } from "@/components/ui/primitives/button";
import { Badge } from "@/components/ui/primitives/badge";
import { Copy, Trash2 } from "@/components/ui/primitives/icons";
import { WORD_CAUTION, wordCaution } from "@/lib/text/word-count";
import type { ItemReview } from "@/lib/review/types";
import { ScoreBadge } from "@/components/ui/review/score-badge";

interface EditorItemRowProps {
    id: string;
    title: string;
    subtitle?: string;
    meta?: string;
    isSelected: boolean;
    onToggleSelected: (checked: boolean) => void;
    onRemove: () => void;
    onDuplicate: () => void;
    usedBy: string[];
    review: ItemReview | null;
    /** The text differs from what the review saw. */
    reviewStale: boolean;
    stale: boolean;
    /** Words across all of the item's text (the size caution). */
    words: number;
    /** First date problem, shown as a badge on the collapsed row. */
    dateError?: string;
    open: boolean;
    onToggleOpen: () => void;
    /** Scroll this row into view and focus its first input when it mounts (freshly added / linked items). */
    autoFocus?: boolean;
    /** Drag handle, rendered before the row toggle. */
    handle?: React.ReactNode;
    /** Sortable wiring (row element + transform), from useSortable. */
    rowRef?: React.Ref<HTMLLIElement & HTMLDivElement>;
    style?: React.CSSProperties;
    children: React.ReactNode;
}

export function EditorItemRow({ id, title, subtitle, meta, isSelected, onToggleSelected, onRemove, onDuplicate, usedBy, review, reviewStale, stale, words, dateError, open, onToggleOpen, autoFocus, handle, rowRef, style, children }: EditorItemRowProps) {
    // Ref callback (not an effect on props): scrolls a freshly added row into view exactly once.
    const focused = useRef(false);
    const focusRef = (node: HTMLDivElement | null) => {
        if (!node || !autoFocus || focused.current) return;
        focused.current = true;
        node.scrollIntoView({ block: "center", behavior: "smooth" });
        node.querySelector<HTMLInputElement>("input, textarea")?.focus({ preventScroll: true });
    };

    const summary = (
        <div className="flex min-w-0 items-center gap-3">
            <div className="min-w-0 flex-1">
                {/* Title on its own line so it never loses space to the subtitle (a long skill list used to cut it to "S.."). */}
                <div className={cn("truncate text-sm font-medium leading-5", isSelected ? "text-fg" : "text-fg-muted")}>{title || <span className="text-fg-subtle">Untitled</span>}</div>
                {subtitle && <div className="mt-0.5 truncate text-13 leading-5 text-fg-subtle">{subtitle}</div>}
            </div>
            <div className="hidden shrink-0 items-center gap-1 sm:flex">
                {review && <ScoreBadge review={review} outdated={reviewStale} />}
                {usedBy.length > 0 && <Badge title={usedBy.join(", ")}>{usedBy.length} {usedBy.length === 1 ? "variant" : "variants"}</Badge>}
                {dateError && <Badge tone="danger" title={dateError}>Check dates</Badge>}
                {words >= WORD_CAUTION && <Badge tone="warning" title={`Over ${WORD_CAUTION} words: cut this item down`}>Too long · {words} words</Badge>}
                {stale && <Badge tone="warning" title="Skills will be analysed when you save">Not analysed</Badge>}
            </div>
            {meta && <span className="hidden w-32 shrink-0 text-right text-13 tabular-nums text-fg-subtle md:inline">{meta}</span>}
        </div>
    );

    const controls = (
        <>
            <Switch checked={isSelected} onChange={onToggleSelected} label={isSelected ? "Included on résumé" : "Not on résumé"} />
            <IconButton icon={Copy} aria-label={`Duplicate ${title || "item"}`} title="Duplicate" onClick={onDuplicate} className="hidden sm:inline-flex" />
            <IconButton icon={Trash2} aria-label={`Delete ${title || "item"}`} title="Delete (undone by Discard)" variant="danger" onClick={onRemove} />
        </>
    );

    return (
        <ExpandableRow id={`edit-${id}`} open={open} onToggle={onToggleOpen} summary={summary} controls={controls} muted={!isSelected} leading={handle} rowRef={rowRef} style={style}>
            <div ref={focusRef} className="space-y-4 pt-1">
                {children}
                <WordCaution words={words} />
            </div>
        </ExpandableRow>
    );
}

function WordCaution({ words }: { words: number }) {
    const { hint, warning } = wordCaution(words);
    if (warning) return <p className="rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-13 text-warning">{warning}</p>;
    return hint ? <p className="text-13 text-fg-subtle">{hint}</p> : null;
}
