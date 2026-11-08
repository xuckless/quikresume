import React from "react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/primitives/badge";
import { FLAG_LABEL, type ItemReview } from "@/lib/review/types";


/** "7/10" coach score; greyed out when the text changed since the review. */
export function ScoreBadge({ review, outdated, className }: { review: ItemReview; outdated?: boolean; className?: string }) {
    const flags = review.flags.map(f => FLAG_LABEL[f]).join(", ");
    return (
        <Badge
            // Never coloured by value (design rule); low scores are listed in Action items instead.
            tone="neutral"
            className={cn("font-mono tabular-nums", outdated ? "text-fg-subtle" : "text-fg-muted", className)}
            title={outdated ? "Coach score for an earlier version of this text" : `Coach score${flags ? `: ${flags}` : ""}`}
        >
            {review.score}/10
        </Badge>
    );
}
