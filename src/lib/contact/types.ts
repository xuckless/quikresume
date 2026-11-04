// src/lib/contact/types.ts
// Link verification results stored on users/{uid}.linkChecks (written by /api/profile/check-links).
// Pure and isomorphic.

import { normalizeField, type LinkField } from "./normalize";

/**
 * ok: the page / profile answered. not-found: 404 / 410 / the domain does not exist (the red mark).
 * unverifiable: timeouts, 5xx, blocked, private addresses (no mark). format-ok: LinkedIn (never fetched).
 */
export type LinkStatus = "ok" | "not-found" | "unverifiable" | "format-ok";

export interface LinkCheck {
    /** The normalised URL that was checked. */
    url: string;
    status: LinkStatus;
    detail: string | null;
    /** ISO timestamp. */
    checkedAt: string;
}

export type LinkChecks = Partial<Record<LinkField, LinkCheck>> & {
    /** Checks of the extra header links (ResumeData.links), matched by URL. */
    extra?: LinkCheck[];
};

const STATUSES: LinkStatus[] = ["ok", "not-found", "unverifiable", "format-ok"];

/** Firestore field names on the user document. */
export const LINK_DOC_FIELD: Record<LinkField, string> = { linkedin: "linkedIn", github: "github", website: "website" };

/** Lenient reader for the stored map (Timestamps or ISO strings). */
function readCheck(raw: unknown): LinkCheck | null {
    const v = raw as Record<string, unknown> | undefined;
    if (!v || typeof v !== "object" || typeof v.url !== "string" || !STATUSES.includes(v.status as LinkStatus)) return null;
    const at = v.checkedAt as { toDate?: () => Date } | string | undefined;
    return {
        url: v.url,
        status: v.status as LinkStatus,
        detail: typeof v.detail === "string" ? v.detail : null,
        checkedAt: typeof at === "string" ? at : typeof at?.toDate === "function" ? at.toDate().toISOString() : "",
    };
}

export function readLinkChecks(raw: unknown): LinkChecks {
    const out: LinkChecks = {};
    if (!raw || typeof raw !== "object") return out;
    for (const [docKey, field] of [["linkedIn", "linkedin"], ["github", "github"], ["website", "website"]] as const) {
        const c = readCheck((raw as Record<string, unknown>)[docKey]);
        if (c) out[field] = c;
    }
    const extra = (raw as Record<string, unknown>).extra;
    if (Array.isArray(extra)) out.extra = extra.slice(0, 10).map(readCheck).filter((c): c is LinkCheck => c !== null);
    return out;
}

/** A stored "not found" for an extra link's current URL. */
export function brokenExtraLink(checks: LinkChecks | undefined, url: string): LinkCheck | null {
    const v = normalizeField("website", url).value;
    return checks?.extra?.find(c => c.url === v && c.status === "not-found") ?? null;
}

/** The stored failure for a field, only while it still describes what is typed (editing clears the mark). */
export function brokenLink(checks: LinkChecks | undefined, field: LinkField, currentValue: string): LinkCheck | null {
    const c = checks?.[field];
    if (!c || c.status !== "not-found") return null;
    return normalizeField(field, currentValue).value === c.url ? c : null;
}
