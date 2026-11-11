"use client";

// Individually switchable bullets / skills. Presentational: the Library wires
// it to a server action, the Editor to the draft.

import React from "react";
import { cn } from "@/lib/cn";
import type { SubItem } from "@/lib/sub-items";
import { FOCUS_RING } from "@/components/ui/primitives/button";
import { Checkbox } from "@/components/ui/primitives/field";

interface SubItemListProps {
    entries: SubItem[];
    hidden: readonly string[];
    onToggle: (key: string) => void;
    variant: "bullets" | "chips";
    /** Prefix for input ids (must be unique on the page). */
    idPrefix: string;
    disabled?: boolean;
    /** Keys that must stay shown (checkbox / chip disabled). */
    lockedKeys?: readonly string[];
    /** Optional note per key (e.g. why it is hidden), shown under a bullet. */
    notes?: Readonly<Record<string, string>>;
    /** Keys to outline (e.g. an AI suggestion is pending on them). */
    highlighted?: readonly string[];
    /** Extra content under a bullet (suggestion actions, warnings). Bullets only. */
    renderExtra?: (entry: SubItem, on: boolean) => React.ReactNode;
    className?: string;
}

export function SubItemList({ entries, hidden, onToggle, variant, idPrefix, disabled, lockedKeys = [], notes = {}, highlighted = [], renderExtra, className }: SubItemListProps) {
    if (entries.length === 0) return null;
    const off = new Set(hidden);
    const shown = entries.filter(e => !off.has(e.key)).length;
    const noun = variant === "bullets" ? "bullets" : "skills";
    // Duplicate lines share a key; render each once.
    const unique = entries.filter((e, i) => entries.findIndex(x => x.key === e.key) === i);

    return (
        <div className={cn("space-y-2", className)}>
            {variant === "bullets" ? (
                <ul className="space-y-1">
                    {unique.map((e, i) => {
                        const on = !off.has(e.key);
                        const id = `${idPrefix}-b${i}`;
                        const locked = lockedKeys.includes(e.key);
                        return (
                            <li key={e.key} className={cn("flex items-start gap-2.5", highlighted.includes(e.key) && "-mx-2 rounded-md px-2 py-1 ai-glow")}>
                                <Checkbox id={id} checked={on} onChange={() => onToggle(e.key)} disabled={disabled || locked} className="mt-0.5" />
                                <div className="min-w-0">
                                    <label htmlFor={id} className={cn("leading-relaxed", locked ? "cursor-not-allowed" : "cursor-pointer", on ? "text-fg-muted" : "text-fg-subtle line-through decoration-fg-subtle/60")}>
                                        {e.label}
                                    </label>
                                    {locked && <span className="block text-xs text-fg-subtle">Names a hard requirement · always shown</span>}
                                    {!on && notes[e.key] && <span className="block text-xs text-fg-subtle">{notes[e.key]}</span>}
                                    {renderExtra?.(e, on)}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            ) : (
                <div className="flex flex-wrap gap-1.5">
                    {unique.map(e => {
                        const on = !off.has(e.key);
                        return (
                            <button
                                key={e.key}
                                type="button"
                                aria-pressed={on}
                                onClick={() => onToggle(e.key)}
                                disabled={disabled || lockedKeys.includes(e.key)}
                                title={lockedKeys.includes(e.key) ? "Names a hard requirement · always shown" : notes[e.key] ?? (on ? "Shown on résumé · click to hide" : "Hidden · click to show")}
                                className={cn(
                                    "press inline-flex h-7 items-center rounded-md border px-2.5 text-xs font-medium",
                                    highlighted.includes(e.key) && "ai-glow",
                                    on
                                        ? "border-border-strong bg-surface text-fg hover:bg-surface-hover"
                                        : "border-dashed border-border bg-transparent text-fg-subtle line-through hover:text-fg-muted",
                                    FOCUS_RING,
                                )}
                            >
                                {e.label}
                            </button>
                        );
                    })}
                </div>
            )}
            {shown < unique.length && (
                <p className="text-xs text-fg-subtle">{shown} of {unique.length} {noun} shown on résumé</p>
            )}
        </div>
    );
}
