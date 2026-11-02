// src/lib/match/semantic.ts
// Pure maths for semantic evidence. No I/O; shared by the server pipeline (lib/match/evidence.ts),
// the calibration scripts and tests.
//
// Raw cosine between embeddings is not a probability: scores bunch in a narrow band and the band
// moves with the model. We turn it into p("this text demonstrates this requirement") with a Platt
// fit, p = σ(a·cos + c·rerank + b), whose coefficients come from labelled pairs
// (scripts/calibration/fit.mjs -> calibration.json). Two fits exist: with the reranker score, and
// cosine-only for when the reranker was skipped (rate limits, failures).

import calibration from "./calibration.json";

export interface PlattFit { a: number; c: number; b: number }

export interface Calibration {
    space: string;
    withRerank: PlattFit;
    cosineOnly: PlattFit;
    /** Pairs the fits were trained on (for the record). */
    n: number;
}

export const CALIBRATION = calibration as Calibration;

export function dot(a: Float32Array, b: Float32Array): number {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
}

export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** Calibrated probability; `rerank` null = cosine-only fit. */
export function probability(cos: number, rerank: number | null, cal: Calibration = CALIBRATION): number {
    if (rerank === null) return sigmoid(cal.cosineOnly.a * cos + cal.cosineOnly.b);
    return sigmoid(cal.withRerank.a * cos + cal.withRerank.c * rerank + cal.withRerank.b);
}

/**
 * Hubness-corrected similarity (CSLS-style) for ranking candidates: generic text ("worked with
 * cross-functional teams") is close to everything, so it is penalised by how close it is to all
 * requirements on average. Used to pick candidates only; probabilities use the raw cosine.
 *   csls(r, u) = 2·cos(r, u) − μ_r − μ_u,  μ = mean of the top-k cosines of that row / column.
 */
export function cslsMatrix(cos: number[][], k = 5): number[][] {
    const R = cos.length;
    const U = R ? cos[0].length : 0;
    const topMean = (xs: number[], kk: number) => {
        const s = [...xs].sort((a, b) => b - a).slice(0, Math.max(1, Math.min(kk, xs.length)));
        return s.reduce((x, y) => x + y, 0) / s.length;
    };
    const muR = cos.map(row => topMean(row, k));
    const muU = Array.from({ length: U }, (_, j) => topMean(cos.map(row => row[j]), Math.min(k, R)));
    return cos.map((row, i) => row.map((c, j) => 2 * c - muR[i] - muU[j]));
}

/** Noisy-OR of independent evidence strengths: 1 − Π(1 − e). Diminishing returns, never above 1. */
export function noisyOr(evidence: number[]): number {
    let miss = 1;
    for (const e of evidence) miss *= 1 - Math.max(0, Math.min(1, e));
    return 1 - miss;
}

/** Recency weight with a half-life in years (current work = 1). */
export const recencyWeight = (ageMonths: number | null, halfLifeYears = 4) =>
    ageMonths === null ? 0.85 : Math.pow(0.5, ageMonths / 12 / halfLifeYears);

/** Text a requirement is embedded / reranked as. The kind disambiguates short names ("Go" the language). */
export function requirementQuery(display: string, kindLabel: string): string {
    return `${display} (${kindLabel})`;
}

/** Instruction-style query for the reranker. */
export function rerankQuery(display: string, kindLabel: string): string {
    return `Does this résumé line show that the candidate has: ${display} (${kindLabel})?`;
}
