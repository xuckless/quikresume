// src/lib/import/linkedin.ts
// LinkedIn profile identity and capture limits. Pure, no imports: the browser extension imports this file
// by relative path (extension/lib/linkedin-session.ts, profile-extract.ts, and src/lib/ext/bridge.ts), so
// the app and the extension compare profile URLs with the same function.

/** Largest captured profile (JSON.stringify length of its ImportEnvelope) the extension sends and the page accepts. */
export const MAX_PROFILE_JSON = 300_000;
/**
 * Longest visible profile text (characters) the extension sends to /api/ext/profile/analyse when its
 * parser cannot read the page; the route refuses more.
 */
export const MAX_PROFILE_TEXT = 40_000;
/** Capture warnings ("Could not read Projects") passed along with a profile. */
export const MAX_CAPTURE_WARNINGS = 20;

/** Shown as the source name in the review step. */
export const LINKEDIN_SOURCE = "LinkedIn profile";

const HOSTS = new Set(["linkedin.com", "www.linkedin.com"]);
const PROFILE_PATH = /^\/in\/([^/]+)\/?$/;
// Vanity names: letters (any script), digits, "-" and "_".
const SLUG = new RegExp("^[\\p{L}\\p{N}_-]{3,100}$", "u");

/**
 * `https://www.linkedin.com/in/<slug>` (slug lowercased, percent-encoded) for a LinkedIn profile page,
 * null for anything else: other hosts or ports, credentials in the URL, http, detail pages
 * (`/in/x/details/...`), encoded slashes. Query and hash are dropped. Identifies a page; it does not
 * prove whose profile it is.
 */
export function canonicalProfileUrl(raw: string): string | null {
    let url: URL;
    try {
        url = new URL(raw.trim());
    } catch {
        return null;
    }
    if (url.protocol !== "https:" || !HOSTS.has(url.hostname) || url.port || url.username || url.password) return null;
    const encoded = PROFILE_PATH.exec(url.pathname)?.[1];
    if (!encoded) return null;
    let slug: string;
    try {
        slug = decodeURIComponent(encoded);
    } catch {
        return null;
    }
    if (!SLUG.test(slug)) return null;
    return `https://www.linkedin.com/in/${encodeURIComponent(slug.toLowerCase())}`;
}
