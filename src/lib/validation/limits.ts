// src/lib/validation/limits.ts
// Size limits for user content, applied on every write path (Save & Exit, Library edits, import)
// and on every résumé body a route receives. Pure and isomorphic. Firestore caps a document at
// 1 MiB and the model prompts are token-priced, so nothing unbounded may reach either.

import { readLinks } from "@/lib/contact/links";
import { RESUME_LIST_KEYS, type PersonalInfo, type ResumeData, type ResumeListKey } from "@/types/schema";
import { stripHiddenChars } from "@/lib/security/prompt";

export const LIMITS = {
    /** Titles, names, companies, categories, issuers, venues, links. */
    short: 300,
    /** Headline, location, GPA, minor, proficiency, year. */
    field: 600,
    /** Skill lists, stacks, authors, award / education details. */
    long: 4_000,
    /** Bullet descriptions and the professional summary. */
    description: 12_000,
    /** Items per section. */
    itemsPerSection: 300,
    /** Tags per item. */
    tagsPerItem: 40,
    /** Hidden sub-item keys per item. */
    hiddenPerItem: 300,
    /** Firestore document ids (auto ids are 20 chars, uuids 36). */
    docId: 128,
} as const;

/** Trims, strips hidden characters and caps a string; anything else becomes "". */
export function clampStr(v: unknown, max: number): string {
    if (typeof v !== "string") return "";
    const s = stripHiddenChars(v).trim();
    return s.length > max ? s.slice(0, max) : s;
}

export function clampList(v: unknown, maxItems: number, maxLen: number): string[] {
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === "string").slice(0, maxItems).map(x => clampStr(x, maxLen));
}

const DOC_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** True for an id this app could have written: auto ids, uuids and temp ids. Refuses paths and dots. */
export function isDocId(id: unknown): id is string {
    return typeof id === "string" && DOC_ID_RE.test(id);
}

export function assertDocId(id: unknown): string {
    if (!isDocId(id)) throw new Error("Invalid item id.");
    return id;
}

export function clampPersonalInfo(p: PersonalInfo): PersonalInfo {
    return {
        firstName: clampStr(p.firstName, LIMITS.short),
        lastName: clampStr(p.lastName, LIMITS.short),
        headline: clampStr(p.headline, LIMITS.field),
        email: clampStr(p.email, LIMITS.short),
        phone: clampStr(p.phone, LIMITS.short),
        location: clampStr(p.location, LIMITS.field),
        github: clampStr(p.github, LIMITS.short),
        linkedin: clampStr(p.linkedin, LIMITS.short),
        website: clampStr(p.website, LIMITS.short),
        summary: clampStr(p.summary, LIMITS.description),
    };
}

type Item = ResumeData[ResumeListKey][number];

const STRING_CAP: Record<string, number> = {
    title: LIMITS.short, company: LIMITS.short, degree: LIMITS.short, institution: LIMITS.short, category: LIMITS.short,
    name: LIMITS.short, issuer: LIMITS.short, role: LIMITS.short, organization: LIMITS.short, venue: LIMITS.short,
    link: LIMITS.short, language: LIMITS.short, startDate: 32, endDate: 32, date: 32, year: 16,
    gpa: LIMITS.field, minor: LIMITS.field, proficiency: LIMITS.field,
    stack: LIMITS.long, items: LIMITS.long, details: LIMITS.long, authors: LIMITS.long,
    description: LIMITS.description,
};

function clampItem(item: Item): Item {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(item)) {
        if (k === "id") out.id = typeof v === "string" ? v.slice(0, LIMITS.docId) : "";
        else if (k === "isSelected") out.isSelected = v !== false;
        else if (k === "tags") out.tags = Array.isArray(v) ? v.slice(0, LIMITS.tagsPerItem) : [];
        else if (k === "tagsHash") out.tagsHash = typeof v === "string" ? v.slice(0, 64) : null;
        else if (k === "hidden") out.hidden = clampList(v, LIMITS.hiddenPerItem, LIMITS.description);
        else if (k in STRING_CAP) out[k] = clampStr(v, STRING_CAP[k]);
        else out[k] = v;
    }
    return out as unknown as Item;
}

/** Every string capped, every list bounded. Shape is preserved; the layout passes through. */
export function clampResumeData(data: ResumeData): ResumeData {
    const next = { ...data, personalInfo: clampPersonalInfo(data.personalInfo) } as ResumeData;
    next.profileTags = Array.isArray(data.profileTags) ? data.profileTags.slice(0, LIMITS.tagsPerItem) : [];
    next.links = readLinks(data.links);
    for (const key of RESUME_LIST_KEYS) {
        const list = Array.isArray(data[key]) ? (data[key] as Item[]) : [];
        (next[key] as Item[]) = list.slice(0, LIMITS.itemsPerSection).filter(it => it && typeof it === "object").map(clampItem);
    }
    return next;
}
