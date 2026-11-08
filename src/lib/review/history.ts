// src/lib/review/history.ts
// What the user already did with the coach's rewrites, kept across re-reviews so the coach converges:
// accepted rewrites are not reworded again, declined ones are not offered again, and a rewrite that only
// swaps synonyms (or invents an outcome / upgrades ownership) is dropped. Pure and isomorphic.

import { bulletKey } from "@/lib/sub-items";
import type { ReviewInput } from "./content";

export interface ReviewHistoryEntry {
    field: string;
    kind: "accepted" | "rejected";
    /** The text the rewrite replaced. */
    current: string;
    /** The rewrite (accepted: now in the item; rejected: what the user declined). */
    proposed: string;
}

/** A suggestion as stored (enough to resolve what happened to it). */
export interface ReviewCandidate {
    id?: string;
    field: string;
    current: string;
    proposed: string;
}

export const MAX_HISTORY = 30;
export const MAX_PRIOR = 6;
const MAX_TEXT = 300;

const clip = (s: string) => s.trim().slice(0, MAX_TEXT);
export const normText = (s: string) => bulletKey(s).toLowerCase().replace(/[.;:,!]+$/, "").trim();

/** Lenient reader for stored history / prior suggestions. */
export function readHistory(v: unknown): ReviewHistoryEntry[] {
    if (!Array.isArray(v)) return [];
    return v.flatMap((x): ReviewHistoryEntry[] => {
        if (!x || typeof x !== "object") return [];
        const o = x as Record<string, unknown>;
        if ((o.kind !== "accepted" && o.kind !== "rejected") || typeof o.field !== "string" || typeof o.current !== "string" || typeof o.proposed !== "string") return [];
        return [{ field: o.field, kind: o.kind, current: o.current, proposed: o.proposed }];
    }).slice(-MAX_HISTORY);
}

export function readCandidates(v: unknown): ReviewCandidate[] {
    if (!Array.isArray(v)) return [];
    return v.flatMap(x => {
        if (!x || typeof x !== "object") return [];
        const o = x as Record<string, unknown>;
        if (typeof o.field !== "string" || typeof o.current !== "string" || typeof o.proposed !== "string") return [];
        return [{ ...(typeof o.id === "string" ? { id: o.id } : {}), field: o.field, current: o.current, proposed: o.proposed }];
    });
}

/** Newest last, deduplicated, capped. */
export function mergeHistory(...lists: ReviewHistoryEntry[][]): ReviewHistoryEntry[] {
    const seen = new Map<string, ReviewHistoryEntry>();
    for (const e of lists.flat()) {
        const k = `${e.kind}|${e.field}|${normText(e.current)}|${normText(e.proposed)}`;
        seen.delete(k);
        seen.set(k, { field: e.field, kind: e.kind, current: clip(e.current), proposed: clip(e.proposed) });
    }
    return [...seen.values()].slice(-MAX_HISTORY);
}

function present(input: ReviewInput, field: string, text: string): boolean {
    const v = input.fields[field];
    if (v === undefined) return false;
    const key = normText(text);
    return Array.isArray(v) ? v.some(b => normText(b) === key) : normText(v) === key;
}

/**
 * Outcomes of earlier suggestions against the item's current text: a rewrite now in the text (and its
 * original gone) was accepted; a dismissed id was declined.
 */
export function resolveOutcomes(input: ReviewInput, candidates: ReviewCandidate[], dismissedIds: Iterable<string> = []): ReviewHistoryEntry[] {
    const dismissed = new Set(dismissedIds);
    const out: ReviewHistoryEntry[] = [];
    for (const c of candidates) {
        if (c.id && dismissed.has(c.id)) out.push({ field: c.field, kind: "rejected", current: c.current, proposed: c.proposed });
        else if (present(input, c.field, c.proposed) && !present(input, c.field, c.current)) {
            out.push({ field: c.field, kind: "accepted", current: c.current, proposed: c.proposed });
        }
    }
    return out;
}

// ---- equivalence ---------------------------------------------------------------------------------

const STOP = new Set([
    "a", "an", "the", "and", "or", "of", "for", "to", "in", "on", "at", "by", "with", "from", "into", "as", "that", "which",
    "its", "their", "our", "my", "i", "we", "me", "it", "this", "these", "those", "across", "via", "using", "over",
]);
/** Openings that are a real defect: rewriting them is a fix, not a synonym swap. */
const WEAK_LEAD = /^(worked|helped|assisted|was|were|been|being|responsible|participated|involved|tasked|duties|handled|did|i|my|we)\b/i;
/** Openings that say the candidate shared the work; a rewrite must not drop that. */
const SHARED_LEAD = /^(helped|assisted|supported|contributed|participated|collaborated|partnered|co-?\w+|worked with)\b/i;
const SHARED_ANY = /\b(help|helped|helping|assist\w*|support\w*|contribut\w*|participat\w*|collaborat\w*|partner\w*|co-?led|co-?\w+ed|with the team|alongside)\b/i;
/** Result phrases a rewrite may not add when the original doesn't state them. */
const OUTCOME = /\b(improv\w*|reduc\w*|cut(?:ting)?|enabl\w*|increas\w*|result\w*|leading to|ensur\w*|boost\w*|driv\w*|sav\w*|accelerat\w*|streamlin\w*|lower\w*|decreas\w*|eliminat\w*|minimi[sz]\w*|maximi[sz]\w*|optimi[sz]\w*|deliver\w*)\b/gi;

const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, "") || w;
export function contentWords(s: string): string[] {
    return (s.toLowerCase().match(/[a-z0-9+#]+/g) ?? []).filter(w => !STOP.has(w)).map(stem);
}
function jaccard(a: string[], b: string[]): number {
    const A = new Set(a), B = new Set(b);
    if (A.size === 0 && B.size === 0) return 1;
    let inter = 0;
    for (const x of A) if (B.has(x)) inter++;
    return inter / (A.size + B.size - inter);
}
const sameSet = (a: string[], b: string[]) => {
    const A = new Set(a), B = new Set(b);
    return A.size === B.size && [...A].every(x => B.has(x));
};

/** Why a rewrite should be dropped, or null when it is a real change. */
export function rewriteProblem(current: string, proposed: string): "equivalent" | "ownership" | "new-outcome" | null {
    const cur = current.trim(), prop = proposed.trim();
    // Ownership: "Helped migrate X" must not become "Migrated X".
    if (SHARED_LEAD.test(cur) && !SHARED_ANY.test(prop)) return "ownership";
    // An outcome the original never states ("…, cutting deployment coupling").
    const curLower = cur.toLowerCase();
    for (const m of prop.matchAll(OUTCOME)) {
        // "cutting" -> "cut", "saving" -> "sav", "improving" -> "impro": present in any form of the word.
        const root = stem(m[0].toLowerCase()).replace(/(.)\1$/, "$1").slice(0, 5);
        if (!curLower.includes(root)) return "new-outcome";
    }
    const A = contentWords(cur), B = contentWords(prop);
    // Same words, different punctuation / case / pronoun: a mechanical fix, keep it.
    if (sameSet(A, B)) return null;
    if (WEAK_LEAD.test(cur)) return null;
    // Synonym swap of the leading verb ("Developed X" -> "Built and shipped X") or light reshuffle.
    if (A.length > 1 && B.length > 1 && jaccard(A.slice(1), B.slice(1)) >= 0.75) return "equivalent";
    if (jaccard(A, B) >= 0.8) return "equivalent";
    return null;
}

/** Drop reason against what the user already accepted / declined, or null. */
export function historyConflict(field: string, current: string, proposed: string, history: ReviewHistoryEntry[]): "accepted-line" | "declined" | null {
    const cur = normText(current), prop = normText(proposed);
    for (const h of history) {
        if (h.field !== field) continue;
        if (h.kind === "accepted" && normText(h.proposed) === cur) return "accepted-line";
        if (h.kind === "rejected") {
            const hp = normText(h.proposed);
            if (hp === prop) return "declined";
            if (normText(h.current) === cur && jaccard(contentWords(h.proposed), contentWords(proposed)) >= 0.7) return "declined";
        }
    }
    return null;
}
