// GET /api/ext/variants -> the saved résumés the side panel's picker offers (newest first).

import { readVariants } from "@/lib/db/variants";
import { extJson, extPreflight, guardExtension } from "@/lib/security/ext-guard";
import { RATE } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const OPTIONS = extPreflight;

export async function GET(req: Request) {
    const g = await guardExtension(req, RATE.extRead);
    if (!g.ok) return g.response;
    const variants = await readVariants(g.uid);
    return extJson(req, { ok: true, variants: variants.slice(0, 100).map(v => ({ id: v.id, name: v.name, labels: v.labels })) });
}
