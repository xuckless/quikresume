// src/lib/jobs/canonical-url.ts
// One job posting = one URL key, whatever tracking junk the board appended. Pure; shared by the
// web app and the extension import route. Identity parameters (Greenhouse gh_jid, Workday jobId,
// LinkedIn currentJobId, Indeed jk, ...) are kept; tracking parameters, the fragment and a
// trailing slash are dropped, and the remaining parameters are sorted.

import { createHash } from "node:crypto";

const TRACKING = new Set([
    "refid", "trk", "trkinfo", "trackingid", "tracking_id", "source", "src", "position", "pagenum", "origin",
    "savedsearchid", "ref", "referer", "referrer", "lipi", "eid", "ebp", "from", "vjs", "tk", "advn", "sjdu",
    "gclid", "fbclid", "msclkid", "mc_cid", "mc_eid", "_hsenc", "_hsmi", "lever-source", "lever-origin", "gh_src",
]);

/** `null` when the string is not an http(s) URL. */
export function canonicalJobUrl(raw: string): string | null {
    let u: URL;
    try {
        u = new URL(raw.trim());
    } catch {
        return null;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    const kept = [...u.searchParams.entries()].filter(([k]) => {
        const key = k.toLowerCase();
        return !key.startsWith("utm_") && !TRACKING.has(key);
    });
    kept.sort(([a], [b]) => a.localeCompare(b));
    u.search = new URLSearchParams(kept).toString();
    let out = `https://${u.host}${u.pathname.replace(/\/+$/, "")}${u.search}`;
    if (out.endsWith("?")) out = out.slice(0, -1);
    return out;
}

/** Firestore-safe key of a canonical URL (24 hex chars of sha256). */
export function jobUrlKey(canonical: string): string {
    return createHash("sha256").update(canonical).digest("hex").slice(0, 24);
}
