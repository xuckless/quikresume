// POST /api/ext/signout -> revokes the calling token (the extension's "Disconnect").

import { revokeToken } from "@/lib/ext/tokens";
import { extJson, extPreflight, guardExtension } from "@/lib/security/ext-guard";
import { RATE } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const OPTIONS = extPreflight;

export async function POST(req: Request) {
    const g = await guardExtension(req, RATE.extRead);
    if (!g.ok) return g.response;
    await revokeToken(g.token);
    return extJson(req, { ok: true });
}
