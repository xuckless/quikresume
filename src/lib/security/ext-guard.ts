// src/lib/security/ext-guard.ts
// Entry check for /api/ext/* (the browser extension). Like guardApi, but authenticated by a Bearer
// token (lib/ext/tokens.ts) instead of the session cookie, so there is no CSRF exposure and no
// same-origin check. CORS is answered only for the extension's own origin:
// chrome-extension://<id> for ids in EXTENSION_IDS (comma-separated); any chrome-extension:// origin
// outside production when EXTENSION_IDS is unset (unpacked dev builds get a random id).
// The extension calls from its background worker with host permissions, which needs no CORS at all;
// the headers exist for the side panel / popup pages.

import "server-only";
import { NextResponse } from "next/server";
import { isGlmConfigured } from "@/lib/glm/client";
import { verifyToken } from "@/lib/ext/tokens";
import { rateLimit, rateLimitResponse, type RatePolicy } from "./rate-limit";
import { AiBudgetError, assertAiBudget } from "./ai-budget";

const allowedIds = () => (process.env.EXTENSION_IDS ?? "").split(",").map(s => s.trim()).filter(Boolean);

export function extensionOriginAllowed(origin: string | null): boolean {
    if (!origin) return false;
    const m = /^chrome-extension:\/\/([a-p]{32})$/.exec(origin);
    if (!m) return false;
    const ids = allowedIds();
    if (ids.length === 0) return process.env.NODE_ENV !== "production";
    return ids.includes(m[1]);
}

function corsHeaders(req: Request): Record<string, string> {
    const origin = req.headers.get("origin");
    if (!extensionOriginAllowed(origin)) return { Vary: "Origin" };
    return {
        "Access-Control-Allow-Origin": origin!,
        "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "600",
        Vary: "Origin",
    };
}

/** JSON reply with the extension's CORS headers. */
export function extJson(req: Request, body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): NextResponse {
    return NextResponse.json(body, { status: init.status ?? 200, headers: { ...corsHeaders(req), ...init.headers } });
}

export const extFail = (req: Request, status: number, error: string, extra: Record<string, unknown> = {}) =>
    extJson(req, { ok: false, error, ...extra }, { status });

/** OPTIONS handler for every /api/ext route. */
export function extPreflight(req: Request): NextResponse {
    return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

/** Re-wrap a response built elsewhere (rate limit) with the CORS headers. */
function withCors(req: Request, res: NextResponse): NextResponse {
    for (const [k, v] of Object.entries(corsHeaders(req))) res.headers.set(k, v);
    return res;
}

export type ExtGuardResult = { ok: true; uid: string; deviceId: string; token: string } | { ok: false; response: NextResponse };

export async function guardExtension(req: Request, policy: RatePolicy, opts: { ai?: boolean; feature?: string; what?: string } = {}): Promise<ExtGuardResult> {
    const origin = req.headers.get("origin");
    // Browsers attach an Origin to extension-page requests; reject any web page origin outright.
    if (origin && !origin.startsWith("chrome-extension://")) return { ok: false, response: extFail(req, 403, "Not allowed.") };
    const header = req.headers.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const who = token ? await verifyToken(token) : null;
    if (!who) return { ok: false, response: extFail(req, 401, "This browser isn't connected to quikResume. Connect it again.", { unpaired: true }) };

    const limit = await rateLimit(policy, who.uid);
    if (!limit.ok) return { ok: false, response: withCors(req, rateLimitResponse(limit, opts.what ?? "requests")) };

    if (opts.ai) {
        if (!isGlmConfigured()) return { ok: false, response: extFail(req, 500, `${opts.feature ?? "This feature"} is not configured on this server.`, { disabled: true }) };
        try {
            await assertAiBudget(who.uid);
        } catch (err) {
            if (err instanceof AiBudgetError) return { ok: false, response: extFail(req, 429, err.message, { budgetExhausted: true }) };
            throw err;
        }
    }
    return { ok: true, uid: who.uid, deviceId: who.deviceId, token };
}
