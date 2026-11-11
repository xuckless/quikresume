// POST /api/ext/pair {code, deviceName, replaces?} -> {ok, token}
// `replaces` is the browser's previous token: when it belongs to the same user it is replaced, not duplicated.
// Redeems a one-time code from /dashboard/extension (lib/ext/tokens.ts). No session: the code is the
// credential, so attempts are rate-limited per IP (durable) on top of the proxy's burst limit.

import { redeemLinkCode } from "@/lib/ext/tokens";
import { extFail, extJson, extPreflight } from "@/lib/security/ext-guard";
import { RATE, rateLimit, rateLimitResponse } from "@/lib/security/rate-limit";
import { clientIp, readJsonBody } from "@/lib/security/request";

export const runtime = "nodejs";
export const OPTIONS = extPreflight;

export async function POST(req: Request) {
    const origin = req.headers.get("origin");
    if (origin && !origin.startsWith("chrome-extension://")) return extFail(req, 403, "Not allowed.");
    const limit = await rateLimit(RATE.extPair, `ip:${clientIp(req)}`);
    if (!limit.ok) return rateLimitResponse(limit, "connection attempts");
    const body = await readJsonBody<{ code?: unknown; deviceName?: unknown; replaces?: unknown }>(req, 4 * 1024);
    if (!body.ok) return body.response;
    const code = typeof body.body.code === "string" ? body.body.code : "";
    const deviceName = typeof body.body.deviceName === "string" ? body.body.deviceName : "";
    const result = await redeemLinkCode(code, deviceName, body.body.replaces);
    return result.ok ? extJson(req, { ok: true, token: result.token }) : extFail(req, 400, result.error);
}
