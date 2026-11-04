"use client";

// The coach review of one item: score, flags, comment and suggested rewrites (Accept / Dismiss).
// Read-only in the editor, where the review describes the last saved text.

import React from "react";
import { cn } from "@/lib/cn";
import { FLAG_LABEL, type ItemReview, type ReviewSuggestion } from "@/lib/review/types";
import { Badge } from "@/components/ui/primitives/badge";
import { Button } from "@/components/ui/primitives/button";
import { RefreshCw, Sparkles } from "@/components/ui/primitives/icons";

interface ReviewPanelProps {
    review: ItemReview | null | undefined;
    /** Suggestions that still apply to the current text and weren't dismissed. */
    suggestions: ReviewSuggestion[];
    /** The text changed since the review (a new review is on its way). */
    stale: boolean;
    /** Written before the current "About you" answers. */
    briefOutdated?: boolean;
    /** This item is being re-reviewed right now. */
    running?: boolean;
    readOnly?: boolean;
    /** Field label for a suggestion ("Bullets", "Summary"). */
    fieldLabel?: (field: string) => string;
    onAccept?: (s: ReviewSuggestion) => void;
    onDismiss?: (s: ReviewSuggestion) => void;
    onReReview?: () => void;
    className?: string;
}

export function ReviewPanel({ review, suggestions, stale, briefOutdated, running, readOnly, fieldLabel, onAccept, onDismiss, onReReview, className }: ReviewPanelProps) {
    if (!review) {
        if (!stale && !running) return null;
        return (
            <div className={cn("flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-13 text-fg-subtle", className)}>
                <Sparkles className="size-3.5" aria-hidden />
                {running ? "Your coach is reviewing this item…" : "Waiting for a coach review…"}
            </div>
        );
    }
    return (
        // The rainbow hairline marks a review that still has rewrites waiting; a spent one stays plain.
        <section aria-label="Coach review" className={cn("space-y-3 rounded-md border border-border bg-surface-muted/50 p-3 text-13", suggestions.length > 0 && "ai-glow", className)}>
            <div className="flex flex-wrap items-center gap-2">
                <Sparkles className="size-3.5 text-fg-subtle" aria-hidden />
                <span className="font-medium text-fg">Coach review</span>
                <Badge tone="neutral" className="font-mono tabular-nums">{review.score}/10</Badge>
                {review.flags.map(f => <Badge key={f} tone="neutral" size="xs">{FLAG_LABEL[f]}</Badge>)}
                {onReReview && (
                    <Button size="sm" variant="ghost" icon={RefreshCw} onClick={onReReview} loading={running} className="ml-auto h-7" title="Ask the coach to review this item again">
                        Re-review
                    </Button>
                )}
            </div>
            {review.comment && <p className="text-fg-muted leading-relaxed">{review.comment}</p>}
            {stale && <p className="text-xs text-fg-subtle">{readOnly ? "Based on the last saved text; it is re-reviewed after you save." : "The text changed since this review; a new one is on its way."}</p>}
            {!stale && briefOutdated && <p className="text-xs text-fg-subtle">Written before you updated your About you answers.</p>}
            {suggestions.length > 0 && (
                <ul className="space-y-2">
                    {suggestions.map(s => (
                        <li key={s.id} className="space-y-1.5 rounded-md border border-border bg-surface p-2.5">
                            {fieldLabel && <p className="text-xs text-fg-subtle">{fieldLabel(s.field)}{s.reason ? ` · ${s.reason}` : ""}</p>}
                            <p className="text-fg-subtle line-through decoration-fg-subtle/60">{s.current}</p>
                            <p className="text-fg">{s.proposed}</p>
                            {!readOnly && (
                                <div className="flex gap-1.5 pt-0.5">
                                    <Button size="sm" variant="primary" className="h-7" onClick={() => onAccept?.(s)}>Accept</Button>
                                    <Button size="sm" variant="ghost" className="h-7" onClick={() => onDismiss?.(s)}>Dismiss</Button>
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
