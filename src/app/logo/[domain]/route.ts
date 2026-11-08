// GET /logo/<domain> -> the company's icon (PNG) for the Job Tracker, or 404 (the client shows a monogram).
// Fetched server-side from Google's favicon service so the page's CSP stays 'self' and the browser never
// calls a third party; only the company domain leaves the server. Signed-in users only. Lives outside
// /api because next.config marks /api no-store, and logos should be cached by the browser.

import { NextResponse } from "next/server";
import { currentUid } from "@/lib/db/session";
import { cleanCompanyDomain } from "@/lib/jobs/company-domain";

export const runtime = "nodejs";

const TTL_MS = 24 * 3600_000;
const MAX = 500;
const cache = new Map<string, { at: number; png: ArrayBuffer | null }>();

const notFound = () => new NextResponse(null, { status: 404, headers: { "Cache-Control": "private, max-age=86400" } });

export async function GET(_req: Request, ctx: { params: Promise<{ domain: string }> }) {
    if (!(await currentUid())) return new NextResponse(null, { status: 401 });
    const { domain: raw } = await ctx.params;
    const domain = cleanCompanyDomain(decodeURIComponent(raw));
    if (!domain || domain !== decodeURIComponent(raw).toLowerCase()) return notFound();

    let hit = cache.get(domain);
    if (!hit || Date.now() - hit.at > TTL_MS) {
        let png: ArrayBuffer | null = null;
        try {
            const res = await fetch(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`, { signal: AbortSignal.timeout(5000) });
            // 404 = Google has no icon (it still sends a generic globe, which we don't want).
            if (res.ok && res.headers.get("content-type")?.startsWith("image/")) {
                const buf = await res.arrayBuffer();
                if (buf.byteLength > 0 && buf.byteLength < 200_000) png = buf;
            }
        } catch {
            png = null;
        }
        if (cache.size >= MAX) cache.delete(cache.keys().next().value!);
        hit = { at: Date.now(), png };
        cache.set(domain, hit);
    }
    if (!hit.png) return notFound();
    return new NextResponse(hit.png, { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=604800", "X-Content-Type-Options": "nosniff" } });
}
