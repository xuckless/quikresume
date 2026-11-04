// src/lib/security/guest-guard.ts
// Entry check for /api/guest/* (the signed-out /start funnel). In order: same-origin, GLM configured,
// per-IP durable rate limit, Turnstile, then the guest AI budget: a small per-IP day (keyed by a hash
// of the IP, never the raw address) inside a global guest pool. Every guest call runs at low effort
// and stores nothing server-side except rate / usage counters.

import "server-only";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { isGlmConfigured } from "@/lib/glm/client";
import { clientIp, isSameOrigin } from "./request";
import { rateLimit, rateLimitResponse, type RatePolicy } from "./rate-limit";
import { AiBudgetError, assertAiBudget, type AiBudget } from "./ai-budget";
import { verifyTurnstile } from "./turnstile";

const envInt = (name: string, fallback: number) => {
    const n = Number(process.env[name]);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

/** Per visitor (IP hash) per day, and all guests together per day. */
export const GUEST_BUDGET: AiBudget = { tokensPerDay: envInt("GUEST_DAILY_TOKEN_BUDGET", 120_000), callsPerDay: envInt("GUEST_DAILY_CALL_BUDGET", 20) };
export const GUEST_POOL = { uid: "guest-pool", budget: { tokensPerDay: envInt("GUEST_POOL_TOKEN_BUDGET", 4_000_000), callsPerDay: envInt("GUEST_POOL_CALL_BUDGET", 1500) } };

const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ ok: false, error, ...extra }, { status });

export type GuestGuardResult = { ok: true; guestId: string } | { ok: false; response: NextResponse };

export async function guardGuest(req: Request, policy: RatePolicy, turnstileToken: string): Promise<GuestGuardResult> {
    if (!isSameOrigin(req)) return { ok: false, response: fail(403, "Cross-site requests are not allowed.") };
    if (!isGlmConfigured()) return { ok: false, response: fail(500, "AI features are not configured on this server.", { disabled: true }) };
    const ip = clientIp(req);
    const guestId = `guest-${createHash("sha256").update(`${process.env.AUTH_SECRET ?? ""}|${ip}`).digest("hex").slice(0, 24)}`;

    const limit = await rateLimit(policy, guestId);
    if (!limit.ok) return { ok: false, response: rateLimitResponse(limit, "tries") };

    const human = await verifyTurnstile(turnstileToken, ip);
    if (!human.ok) return { ok: false, response: fail(403, human.error, { turnstile: true }) };

    try {
        await assertAiBudget(guestId, GUEST_BUDGET);
        await assertAiBudget(GUEST_POOL.uid, GUEST_POOL.budget);
    } catch (err) {
        if (err instanceof AiBudgetError) return { ok: false, response: fail(429, "You've used today's free tries. Sign in with Google to keep going.", { budgetExhausted: true }) };
        throw err;
    }
    return { ok: true, guestId };
}
