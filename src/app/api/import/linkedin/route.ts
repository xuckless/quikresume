import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { guardApi } from "@/lib/security/guard";
import { RATE } from "@/lib/security/rate-limit";
import { analyzeResume } from "@/lib/import/analyze";
import { userInstruction } from "@/lib/import/prompt";
import { fenceUserText } from "@/lib/security/prompt";
import { canonicalProfileUrl, MAX_PROFILE_TEXT } from "@/lib/import/linkedin";
export const runtime = "nodejs";
export const maxDuration = 120;
export async function GET() {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    const { readUserDoc } = await import("@/lib/db/user-collection");
    const { normalizeLinkedIn } = await import("@/lib/contact/normalize");
    const profile = (await readUserDoc(session.user.id)).data();
    const raw = typeof profile?.linkedIn === "string" ? profile.linkedIn : "";
    const linkedin = canonicalProfileUrl(normalizeLinkedIn(raw).value);
    return NextResponse.json({ uid: session.user.id, linkedin }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(req: Request) {
    const g = await guardApi(req, RATE.import, { ai: true, feature: "Resume import", what: "imports" });
    if (!g.ok) return g.response;
    const fail = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });
    if (!req.headers.get("content-type")?.startsWith("application/json")) return fail(400, "Expected JSON.");
    // Stream-bound even when content-length is absent or inaccurate.
    const reader = req.body?.getReader();
    if (!reader) return fail(400, "Missing profile text.");
    let body = "", size = 0;
    const decoder = new TextDecoder();
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_PROFILE_TEXT * 4 + 4096) { await reader.cancel(); return fail(413, "Profile text is too large."); }
            body += decoder.decode(value, { stream: true });
        }
        body += decoder.decode();
        const d = JSON.parse(body);
        if (typeof d.text !== "string" || d.text.trim().length < 20 || d.text.length > MAX_PROFILE_TEXT || typeof d.url !== "string" || !canonicalProfileUrl(d.url)) return fail(400, "Invalid LinkedIn profile text or URL.");
        return analyzeResume(g.uid, [{ type: "text", text: userInstruction("text", "LinkedIn profile") }, { type: "text", text: fenceUserText("LINKEDIN PROFILE TEXT", d.text) }], "LinkedIn profile");
    } catch { return fail(400, "Could not read profile input. Try again."); }
}
