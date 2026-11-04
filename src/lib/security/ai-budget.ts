// src/lib/security/ai-budget.ts
// Per-user daily AI budget (calls + tokens), so one account cannot burn the GLM quota. The route or
// action that owns the request wraps its work in `withAiUser(uid, task, fn)`; `chatCompletion`
// reads that context through AsyncLocalStorage, refuses when the day's budget is spent, and records
// the tokens each call used. Usage lives in the top-level `ai_usage` collection, one doc per user
// and UTC day (`<uid>_<YYYY-MM-DD>`, with `expiresAt` for a TTL policy).
//
// Env: AI_DAILY_TOKEN_BUDGET (default 2 000 000), AI_DAILY_CALL_BUDGET (default 400).

import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firestore";

export interface AiBudget { tokensPerDay: number; callsPerDay: number }

export interface AiContext {
    uid: string;
    /** Short label for the usage breakdown ("import", "review", ...). */
    task: string;
    /** Budget for `uid`; absent = the signed-in user default (aiBudget()). */
    budget?: AiBudget;
    /** A shared pool every call also counts against (all guests together), with its own budget. */
    pool?: { uid: string; budget: AiBudget };
}

const storage = new AsyncLocalStorage<AiContext>();

/** Runs `fn` with the AI budget bound to `uid`; every chatCompletion inside counts against it. */
export function withAiUser<T>(uid: string, task: string, fn: () => Promise<T>, extra: Pick<AiContext, "budget" | "pool"> = {}): Promise<T> {
    return storage.run({ uid, task, ...extra }, fn);
}

export const aiContext = (): AiContext | undefined => storage.getStore();

const envInt = (name: string, fallback: number) => {
    const n = Number(process.env[name]);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

export function aiBudget(): AiBudget {
    return { tokensPerDay: envInt("AI_DAILY_TOKEN_BUDGET", 2_000_000), callsPerDay: envInt("AI_DAILY_CALL_BUDGET", 400) };
}

export class AiBudgetError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "AiBudgetError";
    }
}

export interface AiUsage { calls: number; tokens: number }

const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);
const usageRef = (uid: string) => db.collection("ai_usage").doc(`${uid}_${dayKey()}`);

// Short read cache: a route that makes several calls checks the budget once per few seconds.
const CACHE_MS = 15_000;
const cache = new Map<string, { usage: AiUsage; at: number }>();

export async function readAiUsage(uid: string): Promise<AiUsage> {
    const key = `${uid}_${dayKey()}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.usage;
    const snap = await usageRef(uid).get();
    const d = snap.data() ?? {};
    const usage = { calls: typeof d.calls === "number" ? d.calls : 0, tokens: typeof d.tokens === "number" ? d.tokens : 0 };
    cache.set(key, { usage, at: Date.now() });
    return usage;
}

/** Throws AiBudgetError when the user's day is spent. A store failure lets the call through. */
export async function assertAiBudget(uid: string, budget: AiBudget = aiBudget()): Promise<void> {
    let usage: AiUsage;
    try {
        usage = await readAiUsage(uid);
    } catch (err) {
        console.error("[ai-budget] read failed:", err instanceof Error ? err.message : err);
        return;
    }
    if (usage.calls >= budget.callsPerDay || usage.tokens >= budget.tokensPerDay) {
        throw new AiBudgetError("You have reached today's AI limit. It resets at midnight UTC.");
    }
}

/** Adds one call and its tokens to the day's counters. Never throws. */
export async function recordAiUsage(ctx: AiContext, tokens: number, model: string): Promise<void> {
    if (ctx.pool) await recordAiUsage({ uid: ctx.pool.uid, task: ctx.task }, tokens, model);
    const key = `${ctx.uid}_${dayKey()}`;
    const hit = cache.get(key);
    if (hit) hit.usage = { calls: hit.usage.calls + 1, tokens: hit.usage.tokens + tokens };
    // Nested maps, not dotted paths: set(..., { merge }) treats "a.b" as a literal field name.
    const task = ctx.task.replace(/[^\w-]/g, "_");
    const modelKey = model.replace(/[^\w-]/g, "_");
    try {
        await usageRef(ctx.uid).set({
            uid: ctx.uid,
            day: dayKey(),
            calls: FieldValue.increment(1),
            tokens: FieldValue.increment(tokens),
            byTask: { [task]: { calls: FieldValue.increment(1), tokens: FieldValue.increment(tokens) } },
            byModel: { [modelKey]: FieldValue.increment(tokens) },
            updatedAt: Timestamp.now(),
            expiresAt: Timestamp.fromMillis(Date.now() + 45 * 24 * 3600_000),
        }, { merge: true });
    } catch (err) {
        console.error("[ai-budget] record failed:", err instanceof Error ? err.message : err);
    }
}
