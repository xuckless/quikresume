import React from "react";

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

export function ScoreRing({ score, size = 40, className, showBand = false }: { score: number; size?: number; className?: string; showBand?: boolean }) {
    const stroke = Math.max(3, Math.round(size / 10));
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const ring = (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={showBand ? undefined : className} role="img" aria-label={`Match score ${score}, ${scoreBand(score).toLowerCase()}`}>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--chart-track)" strokeWidth={stroke} />
            <circle
                cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--chart-1)" strokeWidth={stroke} strokeLinecap="round"
                strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(100, score)) / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
            <text x="50%" y="50%" dy="0.36em" textAnchor="middle" fontSize={size * 0.32} fontWeight={600} fill="var(--fg)" style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>{score}</text>
        </svg>
    );
    if (!showBand) return ring;
    return (
        <span className={className} style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            {ring}
            <span className="text-13 font-medium text-fg">{scoreBand(score)}</span>
        </span>
    );
}
