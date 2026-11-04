// src/lib/contact/links.ts
// Extra header links beyond LinkedIn / GitHub / website: portfolio, Behance, ORCID, Google Scholar, a
// licence registry entry... Pure: read / clamp untrusted input, normalise URLs like the website field.

import { normalizeWebsite } from "./normalize";

export interface ProfileLink {
    /** Printed instead of the bare URL when set ("Portfolio", "ORCID"). */
    label: string;
    url: string;
}

export const MAX_LINKS = 6;
export const MAX_LINK_LABEL = 40;
export const MAX_LINK_URL = 300;

/** Untrusted value (Firestore, request body, import) -> bounded list; entries without a URL dropped. */
export function readLinks(raw: unknown): ProfileLink[] {
    if (!Array.isArray(raw)) return [];
    const out: ProfileLink[] = [];
    for (const r of raw) {
        if (!r || typeof r !== "object") continue;
        const o = r as Record<string, unknown>;
        const url = typeof o.url === "string" ? o.url.trim().slice(0, MAX_LINK_URL) : "";
        if (!url) continue;
        const label = typeof o.label === "string" ? o.label.replace(/\s+/g, " ").trim().slice(0, MAX_LINK_LABEL) : "";
        out.push({ label, url });
        if (out.length >= MAX_LINKS) break;
    }
    return out;
}

/** Normalised URLs (https, no trailing slash), duplicates by URL removed; `issues` keyed by index of the result. */
export function normalizeLinks(links: ProfileLink[]): { links: ProfileLink[]; issues: Record<number, string> } {
    const out: ProfileLink[] = [];
    const issues: Record<number, string> = {};
    const seen = new Set<string>();
    for (const l of readLinks(links)) {
        const r = normalizeWebsite(l.url);
        const key = r.value.replace(/\/+$/, "").toLowerCase();
        if (!r.value || seen.has(key)) continue;
        seen.add(key);
        if (r.level === "warning" || r.level === "error") issues[out.length] = r.message ?? "Check this link.";
        out.push({ label: l.label, url: r.value });
    }
    return { links: out, issues };
}

/** Union by URL, existing first (import merge). */
export function mergeLinks(existing: ProfileLink[], incoming: ProfileLink[]): ProfileLink[] {
    return normalizeLinks([...existing, ...incoming]).links.slice(0, MAX_LINKS);
}
