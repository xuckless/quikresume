// src/lib/contact/normalize.ts
// Contact fields of the résumé header: format checks and normalisation. Pure and isomorphic (the
// Profile form and editor run it on blur, the save actions re-run it, the import applies it).
//
// Only a malformed email blocks a save. Phones are formatted as (123) 456-7890 when they are
// US / Canada numbers; others are kept as typed with a note. Links are normalised to full https URLs
// (the Typst template strips the scheme and "www." when printing).

import type { PersonalInfo } from "@/types/schema";

export type ContactField = "email" | "phone" | "linkedin" | "github" | "website";
export const CONTACT_FIELDS: ContactField[] = ["email", "phone", "linkedin", "github", "website"];
export const LINK_FIELDS = ["linkedin", "github", "website"] as const;
export type LinkField = (typeof LINK_FIELDS)[number];

export type IssueLevel = "ok" | "note" | "warning" | "error";

export interface FieldResult {
    /** Normalised value (the input, trimmed, when it could not be normalised). */
    value: string;
    level: IssueLevel;
    message?: string;
}

const ok = (value: string): FieldResult => ({ value, level: "ok" });

// local@domain.tld: no spaces, one @, a dot in the domain, a 2+ letter TLD.
export const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)*\.[A-Za-z]{2,}$/;

export function normalizeEmail(raw: string): FieldResult {
    const v = raw.trim();
    if (!v) return ok("");
    if (!EMAIL_RE.test(v)) return { value: v, level: "error", message: "Enter an email like name@example.com." };
    const at = v.lastIndexOf("@");
    return ok(`${v.slice(0, at)}@${v.slice(at + 1).toLowerCase()}`);
}

const EXT_RE = /\s*(?:ext\.?|extension|x|#)\s*(\d{1,6})\s*$/i;

export function normalizePhone(raw: string): FieldResult {
    const v = raw.trim();
    if (!v) return ok("");
    let body = v;
    let ext = "";
    const m = EXT_RE.exec(v);
    if (m) {
        ext = ` x${m[1]}`;
        body = v.slice(0, m.index);
    }
    const digits = body.replace(/\D/g, "");
    const international = body.trim().startsWith("+");
    const nanp = (d: string) => `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;

    if (/[^\d\s().+\-\/]/.test(body)) return { value: v, level: "warning", message: "Check phone number: it has characters a phone number can't contain." };
    if (international) {
        if (digits.length === 11 && digits.startsWith("1")) return ok(nanp(digits.slice(1)) + ext);
        if (digits.length >= 7 && digits.length <= 15) return { value: `+${body.trim().slice(1).replace(/\s+/g, " ").trim()}${ext}`, level: "note", message: "International number kept as entered." };
        return { value: v, level: "warning", message: "Check phone number." };
    }
    if (digits.length === 10 && !digits.startsWith("0")) return ok(nanp(digits) + ext);
    if (digits.length === 11 && digits.startsWith("1")) return ok(nanp(digits.slice(1)) + ext);
    // National format outside North America (UK 07700 900123, AU 0412 345 678, DE 030 1234567): keep it.
    if (digits.startsWith("0") && digits.length >= 9 && digits.length <= 12) {
        return { value: body.trim().replace(/\s+/g, " ") + ext, level: "note", message: "Kept as entered. Add the country code (e.g. +44) if you apply abroad." };
    }
    return { value: v, level: "warning", message: "Check phone number: expected 10 digits, like (123) 456-7890." };
}

const LINKEDIN_RE = /^(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([A-Za-z0-9\-_%]{3,100})\/?(?:[?#].*)?$/i;
const SLUG_RE = /^[A-Za-z0-9\-_%]{3,100}$/;

export function normalizeLinkedIn(raw: string): FieldResult & { slug: string | null } {
    const v = raw.trim();
    if (!v) return { ...ok(""), slug: null };
    const m = LINKEDIN_RE.exec(v);
    const slug = m ? m[1] : SLUG_RE.test(v) ? v : null;
    if (!slug) return { value: v, level: "warning", message: "Use your profile URL: linkedin.com/in/your-name.", slug: null };
    return { ...ok(`https://www.linkedin.com/in/${slug}`), slug };
}

const GH_USER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
// A repo URL keeps only its owner: the header links to the profile.
const GH_URL_RE = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/?#\s]+)(?:[/?#].*)?$/i;

export function normalizeGitHub(raw: string): FieldResult & { user: string | null } {
    const v = raw.trim();
    if (!v) return { ...ok(""), user: null };
    const m = GH_URL_RE.exec(v);
    const candidate = m ? m[1] : v.replace(/^@/, "");
    if (!GH_USER_RE.test(candidate)) {
        return { value: v, level: "warning", message: "Use your profile URL: github.com/your-username.", user: null };
    }
    return { ...ok(`https://github.com/${candidate}`), user: candidate };
}

export function normalizeWebsite(raw: string): FieldResult {
    const v = raw.trim();
    if (!v) return ok("");
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`;
    let url: URL;
    try {
        url = new URL(withScheme);
    } catch {
        return { value: v, level: "warning", message: "Check the address: it isn't a valid web link." };
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return { value: v, level: "warning", message: "Use a web address (https://…)." };
    if (!url.hostname.includes(".") || url.username || url.password) return { value: v, level: "warning", message: "Check the address, e.g. yourname.dev." };
    url.protocol = "https:";
    const out = url.toString();
    // "https://site.dev/" -> "https://site.dev" (keeps real paths).
    return ok(url.pathname === "/" && !url.search && !url.hash ? out.replace(/\/$/, "") : out);
}

const NORMALIZER: Record<ContactField, (raw: string) => FieldResult> = {
    email: normalizeEmail,
    phone: normalizePhone,
    linkedin: normalizeLinkedIn,
    github: normalizeGitHub,
    website: normalizeWebsite,
};

export function normalizeField(field: ContactField, raw: string): FieldResult {
    return NORMALIZER[field](raw);
}

export const isContactField = (field: string): field is ContactField => (CONTACT_FIELDS as string[]).includes(field);

/** Normalised personal info plus the issue per contact field (ok fields omitted). */
export function normalizeContact(p: PersonalInfo): { info: PersonalInfo; issues: Partial<Record<ContactField, FieldResult>> } {
    const info = { ...p };
    const issues: Partial<Record<ContactField, FieldResult>> = {};
    for (const field of CONTACT_FIELDS) {
        const r = NORMALIZER[field](p[field] ?? "");
        info[field] = r.value;
        if (r.level !== "ok") issues[field] = r;
    }
    return { info, issues };
}

/** The contact problem that blocks saving (only a malformed email), or null. */
export function contactBlocking(p: PersonalInfo): { field: ContactField; message: string } | null {
    const r = normalizeEmail(p.email ?? "");
    return r.level === "error" ? { field: "email", message: r.message ?? "Invalid email." } : null;
}
