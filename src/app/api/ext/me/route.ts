// GET /api/ext/me -> the connected account (name, email, avatar) for the extension popup.

import { readUserDoc } from "@/lib/db/user-collection";
import { extJson, extPreflight, guardExtension } from "@/lib/security/ext-guard";
import { RATE } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const OPTIONS = extPreflight;

export async function GET(req: Request) {
    const g = await guardExtension(req, RATE.extRead);
    if (!g.ok) return g.response;
    const d = (await readUserDoc(g.uid)).data() ?? {};
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    const name = [str(d.firstName), str(d.lastName)].filter(Boolean).join(" ") || str(d.name);
    return extJson(req, { ok: true, user: { name, email: str(d.email), image: str(d.image) } });
}
