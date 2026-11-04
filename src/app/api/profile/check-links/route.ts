// src/app/api/profile/check-links/route.ts
// POST (no body) -> { ok, changed, linkChecks }.
// Verifies the saved header links (GitHub via its API, personal site with a guarded HEAD, LinkedIn by
// format only) and stores the results on users/{uid}.linkChecks. Runs after a save, fire-and-forget: the
// save never waits for it. Results are cached per URL for 24 h and the route is throttled per user
// (10 s between runs, plus the hourly rate limit in lib/security/rate-limit.ts).

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firestore";
import { LINK_FIELDS, normalizeGitHub, normalizeLinkedIn, normalizeWebsite, type LinkField } from "@/lib/contact/normalize";
import { LINK_DOC_FIELD, readLinkChecks, type LinkCheck } from "@/lib/contact/types";
import { checkGitHub, checkWebsite } from "@/lib/contact/link-check";
import { normalizeLinks, readLinks } from "@/lib/contact/links";
import { guardApi } from "@/lib/security/guard";
import { RATE } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

const CACHE_MS = 24 * 3600_000;
const THROTTLE_MS = 10_000;

const fail = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: Request) {
    const g = await guardApi(req, RATE.linkChecks, { what: "link checks" });
    if (!g.ok) return g.response;
    const ref = db.collection("users").doc(g.uid);

    const snap = await ref.get();
    const data = snap.data();
    if (!data) return fail(404, "Profile not found.");
    const lastRun = data.linkChecksAt as Timestamp | undefined;
    if (lastRun && typeof lastRun.toMillis === "function" && Date.now() - lastRun.toMillis() < THROTTLE_MS) {
        return fail(429, "Links were checked a moment ago.");
    }

    const previous = readLinkChecks(data.linkChecks);
    const now = new Date();
    const fresh = (c: LinkCheck | undefined, url: string) =>
        c && c.url === url && c.checkedAt && now.getTime() - Date.parse(c.checkedAt) < CACHE_MS ? c : null;

    const stored = (f: LinkField) => (typeof data[LINK_DOC_FIELD[f]] === "string" ? (data[LINK_DOC_FIELD[f]] as string) : "");
    const results: Partial<Record<LinkField, LinkCheck | null>> = {};

    await Promise.all(LINK_FIELDS.map(async field => {
        const raw = stored(field);
        if (!raw) { results[field] = null; return; }
        const at = now.toISOString();
        if (field === "linkedin") {
            const r = normalizeLinkedIn(raw);
            // Never fetched: a valid profile URL is all we can honestly say.
            results[field] = r.slug ? { url: r.value, status: "format-ok", detail: null, checkedAt: at } : null;
            return;
        }
        if (field === "github") {
            const r = normalizeGitHub(raw);
            if (!r.user) { results[field] = null; return; }
            const cached = fresh(previous.github, r.value);
            results[field] = cached ?? { url: r.value, ...(await checkGitHub(r.user)), checkedAt: at };
            return;
        }
        const r = normalizeWebsite(raw);
        if (r.level !== "ok") { results[field] = null; return; }
        const cached = fresh(previous.website, r.value);
        results[field] = cached ?? { url: r.value, ...(await checkWebsite(r.value)), checkedAt: at };
    }));

    // Extra header links: same guarded HEAD as the website, cached per URL.
    const prevExtra = new Map((previous.extra ?? []).map(c => [c.url, c]));
    const extra: LinkCheck[] = [];
    await Promise.all(normalizeLinks(readLinks(data.links)).links.map(async (l, i) => {
        const r = normalizeWebsite(l.url);
        if (r.level !== "ok") return;
        extra[i] = fresh(prevExtra.get(r.value), r.value) ?? { url: r.value, ...(await checkWebsite(r.value)), checkedAt: now.toISOString() };
    }));
    const extraList = extra.filter(Boolean);

    const patch: Record<string, unknown> = { linkChecksAt: Timestamp.fromDate(now), "linkChecks.extra": extraList };
    let changed = false;
    if (JSON.stringify(extraList.map(c => [c.url, c.status])) !== JSON.stringify((previous.extra ?? []).map(c => [c.url, c.status]))) changed = true;
    for (const field of LINK_FIELDS) {
        const next = results[field] ?? null;
        const prev = previous[field];
        if ((prev?.status ?? null) !== (next?.status ?? null) || (prev?.url ?? null) !== (next?.url ?? null)) changed = true;
        patch[`linkChecks.${LINK_DOC_FIELD[field]}`] = next ?? FieldValue.delete();
    }
    // update(), not set(merge): dotted paths address the nested map, and a deleted user is never recreated.
    await ref.update(patch);

    if (changed) {
        revalidatePath("/dashboard");
        revalidatePath("/dashboard/profile");
    }
    const linkChecks = { ...Object.fromEntries(LINK_FIELDS.flatMap(f => (results[f] ? [[f, results[f]]] : []))), extra: extraList };
    return NextResponse.json({ ok: true, changed, linkChecks });
}
