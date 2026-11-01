// src/components/brand.tsx
// The quikResume mark (Route A): a lowercase q drawn as a ring and stem whose tail is a thunderbolt,
// on a 32-unit grid. Colours come from the theme tokens, so the mark follows light / dark mode:
// --accent is #003200 in light and #5fd38a in dark. Static copies for favicons and the extension
// live in public/icons (rendered from the same paths).

import React from "react";
import { cn } from "@/lib/cn";

const RING = { cx: 12.5, cy: 12.5, r: 7.25 };
const BOLT = "M18.5 4.5h3.75V18H26l-7.5 12 1.4-8h-3.3l1.9-4z";

/** The bare q-bolt glyph, coloured with the accent. */
export function QBolt({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 32 32" aria-hidden className={cn("text-accent", className)}>
            <circle {...RING} fill="none" stroke="currentColor" strokeWidth={3.5} />
            <path fill="currentColor" d={BOLT} />
        </svg>
    );
}

/** App-icon style monogram: the glyph knocked out of an accent rounded square. */
export function BrandMonogram({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 32 32" aria-hidden className={className}>
            <rect width={32} height={32} rx={7} fill="var(--accent)" />
            <g transform="translate(5.38 3.94) scale(0.72)">
                <circle {...RING} fill="none" stroke="var(--accent-fg)" strokeWidth={3.5} />
                <path fill="var(--accent-fg)" d={BOLT} />
            </g>
        </svg>
    );
}

/**
 * "quikResume": the q-bolt stands in for the q, the R is in the accent. Font size drives the whole
 * lockup (the glyph is 1em and drops 0.13em so the bolt hangs below the baseline like a descender).
 */
export function Wordmark({ className }: { className?: string }) {
    return (
        <span className={cn("inline-flex items-end font-semibold leading-none tracking-[-0.03em] text-fg", className)} aria-label="quikResume" role="img">
            <QBolt className="mb-[-0.13em] size-[1em] shrink-0" />
            <span aria-hidden>uik</span>
            <span aria-hidden className="text-accent">R</span>
            <span aria-hidden>esume</span>
        </span>
    );
}
