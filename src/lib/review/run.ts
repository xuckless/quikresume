// src/lib/review/run.ts
// Server-only: runs the coach review over items in small chunks with a concurrency pool and a wall-clock
// budget (same shape as tag extraction), plus a per-user lock so two tabs never review at once.

import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firestore";
import { chatCompletion, textModel } from "@/lib/glm/client";
import { effortFor, maxTokensFor, type Effort } from "@/lib/glm/effort";
import { extractJson } from "@/lib/import/parsed-resume";
import type { CandidatePromptContext } from "@/lib/about/types";
import type { ReviewInput } from "./content";
import { parseReviewReply, type ParsedReview } from "./parse";
import { REVIEW_SYSTEM_PROMPT, reviewUserMessage } from "./prompt";

export const REVIEW_CHUNK = 6;
export const REVIEW_CONCURRENCY = 2;
/** Items reviewed per request; the client asks again while `remaining > 0`. */
export const REVIEW_MAX_PER_RUN = 24;
// Sized for high reasoning effort inside the route's 300 s maxDuration.
const DEFAULT_BUDGET_MS = 260_000;
const CHUNK_TIMEOUT_MS = 120_000;
const LOCK_TTL_MS = 310_000;

export async function reviewItems(
    inputs: ReviewInput[],
    candidate: CandidatePromptContext | null,
    opts: { budgetMs?: number; effort?: Effort } = {},
): Promise<{ byId: Record<string, ParsedReview>; skipped: string[] }> {
    const deadline = Date.now() + (opts.budgetMs ?? DEFAULT_BUDGET_MS);
    const chunks: ReviewInput[][] = [];
    for (let i = 0; i < inputs.length; i += REVIEW_CHUNK) chunks.push(inputs.slice(i, i + REVIEW_CHUNK));

    const effort = opts.effort ?? effortFor("review");
    const byId: Record<string, ParsedReview> = {};
    const skipped: string[] = [];
    let next = 0;
    const worker = async () => {
        while (next < chunks.length) {
            const chunk = chunks[next++];
            const left = deadline - Date.now();
            if (left < 20_000) { skipped.push(...chunk.map(c => c.id)); continue; }
            try {
                const result = await chatCompletion(
                    [{ role: "system", content: REVIEW_SYSTEM_PROMPT }, { role: "user", content: reviewUserMessage(chunk, candidate) }],
                    { model: textModel(), json: true, effort, temperature: 0.1, maxTokens: maxTokensFor(effort, 8000), timeoutMs: Math.min(CHUNK_TIMEOUT_MS, left), retries: 0 },
                );
                const parsed = parseReviewReply(extractJson(result.text), chunk, candidate ? `${candidate.brief} ${candidate.facts.graduation ?? ""}` : "");
                for (const c of chunk) {
                    if (parsed[c.id]) byId[c.id] = parsed[c.id];
                    else skipped.push(c.id);
                }
            } catch (err) {
                console.error("[review] chunk failed:", err instanceof Error ? err.message : err);
                skipped.push(...chunk.map(c => c.id));
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(REVIEW_CONCURRENCY, chunks.length) }, worker));
    return { byId, skipped };
}

const lockRef = (uid: string) => db.collection("users").doc(uid).collection("meta").doc("review");

/** True when this request may run; false while another run holds an unexpired lock. */
export async function acquireReviewLock(uid: string): Promise<boolean> {
    return db.runTransaction(async tx => {
        const snap = await tx.get(lockRef(uid));
        const until = snap.get("runningUntil") as Timestamp | null | undefined;
        if (until && until.toMillis() > Date.now()) return false;
        tx.set(lockRef(uid), { runningUntil: Timestamp.fromMillis(Date.now() + LOCK_TTL_MS), lastRunAt: Timestamp.now() }, { merge: true });
        return true;
    });
}

export async function releaseReviewLock(uid: string): Promise<void> {
    await lockRef(uid).set({ runningUntil: null }, { merge: true });
}
