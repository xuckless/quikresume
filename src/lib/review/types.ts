// src/lib/review/types.ts
// AI career-coach review of one library item (or the profile headline + summary). Stored on the item doc
// as `review` (users/{uid}.profileReview for the profile). Pure and isomorphic.

import type { ResumeListKey } from "@/types/schema";
import { readCandidates, readHistory, type ReviewCandidate, type ReviewHistoryEntry } from "./history";

export const REVIEW_FLAGS = [
    "too-wordy", "vague", "no-metrics", "weak-verb", "buzzwords", "passive-voice", "first-person",
    "inconsistent-tense", "missing-context", "off-target", "level-mismatch", "typos", "redundant", "incomplete",
] as const;
export type ReviewFlag = (typeof REVIEW_FLAGS)[number];

export const FLAG_LABEL: Record<ReviewFlag, string> = {
    "too-wordy": "Too wordy",
    vague: "Vague",
    "no-metrics": "No numbers",
    "weak-verb": "Weak verbs",
    buzzwords: "Buzzwords",
    "passive-voice": "Passive voice",
    "first-person": "First person",
    "inconsistent-tense": "Mixed tenses",
    "missing-context": "Missing context",
    "off-target": "Off target",
    "level-mismatch": "Level mismatch",
    typos: "Typos",
    redundant: "Repetitive",
    incomplete: "Incomplete",
};

export type ReviewTarget = ResumeListKey | "profile";

export interface ReviewSuggestion {
    /** stableHash of field + current + proposed. */
    id: string;
    /** Editor-model field name (e.g. "description", "title", "summary"). */
    field: string;
    /** The exact text replaced: one bullet for bullet fields, the whole value otherwise. */
    current: string;
    proposed: string;
    reason: string;
}

export interface ItemReview {
    /** 0–10. */
    score: number;
    flags: ReviewFlag[];
    comment: string;
    suggestions: ReviewSuggestion[];
    /** Suggestion ids the user dismissed (kept across re-reviews: an identical rewrite stays hidden). */
    dismissed: string[];
    /** What the user accepted / declined in earlier reviews; sent back to the coach so it converges. */
    history: ReviewHistoryEntry[];
    /** Suggestions of the review this one replaced, still unresolved when it was written (an accept made
     *  while this review ran is recognised from them on the next run). */
    prior: ReviewCandidate[];
    /** Content hash of the text that was reviewed (same hash rule as tags). */
    reviewHash: string;
    /** Candidate brief hash at review time (null: reviewed without "About you"). */
    briefHash: string | null;
    reviewedAt: string | null;
}

/** Coach score at or below which an item is listed under Action items. */
export const LOW_SCORE = 5;

const isFlag = (v: unknown): v is ReviewFlag => typeof v === "string" && (REVIEW_FLAGS as readonly string[]).includes(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Lenient reader for a stored review (Timestamp or ISO `reviewedAt`); null when absent or malformed. */
export function readReview(v: unknown): ItemReview | null {
    if (!v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    if (typeof o.score !== "number" || typeof o.reviewHash !== "string") return null;
    const at = o.reviewedAt as { toDate?: () => Date } | string | undefined;
    return {
        score: Math.max(0, Math.min(10, Math.round(o.score))),
        flags: Array.isArray(o.flags) ? o.flags.filter(isFlag) : [],
        comment: str(o.comment),
        suggestions: Array.isArray(o.suggestions)
            ? o.suggestions.flatMap(s => {
                if (!s || typeof s !== "object") return [];
                const x = s as Record<string, unknown>;
                if (typeof x.id !== "string" || typeof x.field !== "string" || typeof x.current !== "string" || typeof x.proposed !== "string") return [];
                return [{ id: x.id, field: x.field, current: x.current, proposed: x.proposed, reason: str(x.reason) }];
            })
            : [],
        dismissed: Array.isArray(o.dismissed) ? o.dismissed.filter((x): x is string => typeof x === "string") : [],
        history: readHistory(o.history),
        prior: readCandidates(o.prior),
        reviewHash: o.reviewHash,
        briefHash: typeof o.briefHash === "string" ? o.briefHash : null,
        reviewedAt: typeof at === "string" ? at : typeof at?.toDate === "function" ? at.toDate().toISOString() : null,
    };
}
