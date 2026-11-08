"use client";

import React, { useEffect, useRef, useState } from "react";
import { Swap } from "./swap";

// One green for every score (brand rule: colour never grades the user); the word band carries the meaning.

/** Word band for a 0..100 match score. */
export function scoreBand(score: number): string {
    return score >= 80 ? "Strong fit" : score >= 60 ? "Good fit" : score >= 40 ? "Partial fit" : "Weak fit";
}

/** Kept for callers that colour other marks by score; now always the accent. */
export function scoreColor(score: number) {
    void score;
    return "var(--chart-1)";
}

/**
 * The number eases to a new score (ease-out, 320 ms) instead of jumping, so a change such as a preliminary
 * score being confirmed reads as an update. The first render shows the real value (no count from 0).
 */
function useCountTo(target: number): number {
    const [shown, setShown] = useState(target);
    const from = useRef(target);
    useEffect(() => {
        const start = from.current;
        from.current = target;
        if (start === target) return;
        // Reduced motion: lands on the first frame.
        const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 320;
        const t0 = performance.now();
        let raf = 0;
        const tick = (now: number) => {
            const p = duration === 0 ? 1 : Math.min(1, (now - t0) / duration);
            const eased = 1 - Math.pow(1 - p, 3);
            setShown(Math.round(start + (target - start) * eased));
            if (p < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [target]);
    return shown;
}

export function ScoreRing({ score, size = 40, className, showBand = false }: { score: number; size?: number; className?: string; showBand?: boolean }) {
    const shown = useCountTo(score);
    const stroke = Math.max(3, Math.round(size / 10));
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const ring = (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={showBand ? undefined : className} role="img" aria-label={`Match score ${score}, ${scoreBand(score).toLowerCase()}`}>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--chart-track)" strokeWidth={stroke} />
            <circle
                cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--chart-1)" strokeWidth={stroke} strokeLinecap="round"
                strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(100, score)) / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`}
                // Draws in on mount, eases to a new value (globals.css .score-arc).
                className="score-arc" style={{ ["--ring-c" as string]: c }}
            />
            <text x="50%" y="50%" dy="0.36em" textAnchor="middle" fontSize={size * 0.32} fontWeight={600} fill="var(--fg)" style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>{shown}</text>
        </svg>
    );
    if (!showBand) return ring;
    return (
        <span className={className} style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            {ring}
            <Swap swapKey={scoreBand(score)} className="text-13 font-medium text-fg">{scoreBand(score)}</Swap>
        </span>
    );
}
