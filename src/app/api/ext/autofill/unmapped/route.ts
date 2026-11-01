// POST /api/ext/autofill/unmapped {host, labels: string[]} -> remembered on Autofill preferences so the
// user can add answers for fields Auto Fill could not fill.

import { addUnmapped } from "@/lib/db/autofill";
import { extJson, extPreflight, guardExtension } from "@/lib/security/ext-guard";
import { RATE } from "@/lib/security/rate-limit";
import { readJsonBody } from "@/lib/security/request";
import { sanitizeForPrompt } from "@/lib/security/prompt";

export const runtime = "nodejs";
export const OPTIONS = extPreflight;

export async function POST(req: Request) {
    const g = await guardExtension(req, RATE.extRead);
    if (!g.ok) return g.response;
    const body = await readJsonBody<{ host?: unknown; labels?: unknown }>(req, 32 * 1024);
    if (!body.ok) return body.response;
    const host = typeof body.body.host === "string" ? body.body.host.toLowerCase().replace(/[^a-z0-9.-]/g, "").slice(0, 120) : "";
    const labels = (Array.isArray(body.body.labels) ? body.body.labels : [])
        .filter((l): l is string => typeof l === "string").slice(0, 30).map(l => sanitizeForPrompt(l, 200)).filter(l => l.length >= 2);
    await addUnmapped(g.uid, labels.map(label => ({ label, host })));
    return extJson(req, { ok: true });
}
