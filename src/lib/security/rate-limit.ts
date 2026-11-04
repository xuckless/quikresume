// src/lib/security/rate-limit.ts
// Per-user rate limits that hold across serverless instances. Fixed windows stored in the
// top-level `rate_limits` collection (one doc per policy + user, updated in a transaction), mirrored
// in memory so a caller that is already over the limit is refused without a Firestore round trip.
//
// Every doc carries `expiresAt`; enable a TTL policy on that field (see README) and old windows
// disappear on their own. Firestore trouble never blocks a request: the in-memory count decides.

import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { db } from "@/lib/firestore";
import { memoryHit, memoryPeek, memorySet } from "./memory-limit";

export interface RatePolicy {
    /** Doc-id prefix, also the name shown in logs. */
    name: string;
    limit: number;
    windowMs: number;
    /** false = in-memory only (cheap endpoints such as polls); default true = Firestore-backed. */
    durable?: boolean;
}

const HOUR = 3600_000;
const MINUTE = 60_000;

/** One policy per expensive operation. Numbers are per user per window. */
export const RATE = {
    /** Résumé import: one vision call per upload. */
    import: { name: "import", limit: 12, windowMs: HOUR },
    /** New job analysis (+ background reconcile at max effort). */
    jobAnalyze: { name: "job-analyze", limit: 20, windowMs: HOUR },
    /** "Re-check with AI". */
    reconcile: { name: "reconcile", limit: 20, windowMs: HOUR },
    /** Tailor plan (high effort). */
    tailor: { name: "tailor", limit: 20, windowMs: HOUR },
    proposals: { name: "proposals", limit: 20, windowMs: HOUR },
    skillAnswers: { name: "skill-answers", limit: 30, windowMs: HOUR },
    /** Tagging of unsaved items (uploads, live Job Match). */
    tagsAnalyze: { name: "tags-analyze", limit: 30, windowMs: HOUR },
    /** Re-tag the whole library. */
    tagsBackfill: { name: "tags-backfill", limit: 6, windowMs: HOUR },
    /** Coach review run (≤ 24 items, high effort). */
    review: { name: "review", limit: 20, windowMs: HOUR },
    /** About you: prefill / follow-ups / save. */
    about: { name: "about", limit: 30, windowMs: HOUR },
    linkChecks: { name: "link-checks", limit: 30, windowMs: HOUR },
    /** Extension pairing: code creation per user, redemption per IP. */
    extCode: { name: "ext-code", limit: 10, windowMs: HOUR },
    extPair: { name: "ext-pair", limit: 10, windowMs: HOUR },
    /** Extension reads (lookups, match summaries, status changes). */
    extRead: { name: "ext-read", limit: 600, windowMs: HOUR },
    /** Signed-out /start funnel, per visitor (IP hash). */
    guestImport: { name: "guest-import", limit: 4, windowMs: HOUR },
    guestMatch: { name: "guest-match", limit: 6, windowMs: HOUR },
    /** Auto Fill AI answers (one call per form page). */
    autofill: { name: "autofill", limit: 40, windowMs: HOUR },
    /** Save & Exit (runs the tagger). */
    save: { name: "save", limit: 60, windowMs: HOUR },
    /** Dev-only effort comparison. */
    devCompare: { name: "dev-compare", limit: 10, windowMs: HOUR },
    /** Reconcile status poll (one doc read every 5 s while a run is in flight). */
    poll: { name: "poll", limit: 30, windowMs: MINUTE, durable: false },
} satisfies Record<string, RatePolicy>;

export interface RateLimitResult {
    ok: boolean;
    limit: number;
    remaining: number;
    retryAfterMs: number;
}

const docId = (policy: RatePolicy, key: string) => `${policy.name}__${key}`;

/**
 * Counts one hit for `key` (normally the user id) under `policy`. Returns whether it is allowed
 * and, when not, how long to wait.
 */
export async function rateLimit(policy: RatePolicy, key: string): Promise<RateLimitResult> {
    const id = docId(policy, key);
    const now = Date.now();

    if (policy.durable === false) {
        const m = memoryHit(id, policy.limit, policy.windowMs, now);
        return { ok: m.ok, limit: policy.limit, remaining: m.remaining, retryAfterMs: m.ok ? 0 : m.retryAfterMs };
    }

    // Fast path: this instance already knows the window is exhausted.
    const known = memoryPeek(id, policy.windowMs, now);
    if (known && known.count >= policy.limit) {
        return { ok: false, limit: policy.limit, remaining: 0, retryAfterMs: known.windowStart + policy.windowMs - now };
    }

    try {
        const ref = db.collection("rate_limits").doc(id);
        const verdict = await db.runTransaction(async tx => {
            const snap = await tx.get(ref);
            const d = snap.data() ?? {};
            const start = typeof d.windowStart === "number" ? d.windowStart : 0;
            const inWindow = now - start < policy.windowMs;
            const count = inWindow && typeof d.count === "number" ? d.count : 0;
            const windowStart = inWindow ? start : now;
            if (count >= policy.limit) return { ok: false, count, windowStart };
            tx.set(ref, {
                count: count + 1,
                windowStart,
                key,
                policy: policy.name,
                expiresAt: Timestamp.fromMillis(windowStart + policy.windowMs + 24 * HOUR),
                updatedAt: Timestamp.now(),
            });
            return { ok: true, count: count + 1, windowStart };
        });
        memorySet(id, verdict.count, verdict.windowStart);
        return {
            ok: verdict.ok,
            limit: policy.limit,
            remaining: Math.max(0, policy.limit - verdict.count),
            retryAfterMs: verdict.ok ? 0 : verdict.windowStart + policy.windowMs - now,
        };
    } catch (err) {
        console.error(`[rate-limit] ${policy.name} store failed; using the local count:`, err instanceof Error ? err.message : err);
        const m = memoryHit(id, policy.limit, policy.windowMs, now);
        return { ok: m.ok, limit: policy.limit, remaining: m.remaining, retryAfterMs: m.ok ? 0 : m.retryAfterMs };
    }
}

const minutes = (ms: number) => Math.max(1, Math.ceil(ms / MINUTE));

/** The 429 reply for a refused request, with a Retry-After header the client can honour. */
export function rateLimitResponse(result: RateLimitResult, what = "requests"): NextResponse {
    const seconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
    const wait = result.retryAfterMs >= MINUTE ? `${minutes(result.retryAfterMs)} min` : `${seconds} s`;
    return NextResponse.json(
        { ok: false, error: `Too many ${what} in a short time. Try again in about ${wait}.`, retryAfter: seconds, rateLimited: true },
        { status: 429, headers: { "Retry-After": String(seconds), "X-RateLimit-Limit": String(result.limit), "X-RateLimit-Remaining": String(result.remaining) } },
    );
}

/** Plain-text version for server actions (which return objects, not responses). */
export function rateLimitMessage(result: RateLimitResult, what = "saves"): string {
    const wait = result.retryAfterMs >= MINUTE ? `${minutes(result.retryAfterMs)} min` : `${Math.max(1, Math.ceil(result.retryAfterMs / 1000))} s`;
    return `Too many ${what} in a short time. Try again in about ${wait}.`;
}
