// src/lib/tags/content.ts
// What the tagger sees and what gets hashed. Pure and isomorphic.
//
// HASH RULE: `contentFields` is the only thing hashed (dates, ids, isSelected
// and timestamps are excluded). Changing the field list changes every hash and
// makes every stored item stale once (one full re-extraction on next save).

import type { PersonalInfo, ResumeData, ResumeListKey } from "@/types/schema";
import { RESUME_LIST_KEYS } from "@/types/schema";
import { stableHash } from "@/lib/hash";
import { toBullets } from "@/lib/typst/doc";

export type TagSection = ResumeListKey | "profile";

/** One unit of work for the tagger. */
export interface TagInput {
    id: string;
    section: TagSection;
    text: string;
}

export const PROFILE_ID = "profile";

const t = (v: string | null | undefined) => (v ?? "").trim();

function contentFields<K extends ResumeListKey>(key: K, item: ResumeData[K][number]): string[] {
    switch (key) {
        case "workExperience": { const x = item as ResumeData["workExperience"][number]; return [t(x.title), t(x.company), t(x.description)]; }
        case "education": { const x = item as ResumeData["education"][number]; return [t(x.degree), t(x.institution), t(x.gpa), t(x.minor), t(x.details)]; }
        case "skills": { const x = item as ResumeData["skills"][number]; return [t(x.category), t(x.items)]; }
        case "projects": { const x = item as ResumeData["projects"][number]; return [t(x.title), t(x.stack), t(x.link), t(x.description)]; }
        case "certifications": { const x = item as ResumeData["certifications"][number]; return [t(x.name), t(x.issuer)]; }
        case "awards": { const x = item as ResumeData["awards"][number]; return [t(x.title), t(x.issuer), t(x.description)]; }
        case "volunteering": { const x = item as ResumeData["volunteering"][number]; return [t(x.role), t(x.organization), t(x.description)]; }
        case "publications": { const x = item as ResumeData["publications"][number]; return [t(x.title), t(x.venue), t(x.authors)]; }
        case "languages": { const x = item as ResumeData["languages"][number]; return [t(x.language), t(x.proficiency)]; }
        case "custom": { const x = item as ResumeData["custom"][number]; return [t(x.section), t(x.title), t(x.subtitle), t(x.description)]; }
    }
    return [];
}

export function contentHashOf<K extends ResumeListKey>(key: K, item: ResumeData[K][number]): string {
    return stableHash(`${key}|${JSON.stringify(contentFields(key, item))}`);
}

export function hasContent<K extends ResumeListKey>(key: K, item: ResumeData[K][number]): boolean {
    return contentFields(key, item).some(f => f !== "");
}

const bullets = (text: string) => toBullets(text).map(b => `- ${b}`).join("\n");
const paren = (v: string) => (v ? ` (${v})` : "");

/** Human-readable rendering of one item for the tagger. */
export function itemText<K extends ResumeListKey>(key: K, item: ResumeData[K][number]): string {
    switch (key) {
        case "workExperience": { const x = item as ResumeData["workExperience"][number]; return `Work experience: ${t(x.title)} at ${t(x.company)}\n${bullets(x.description)}`.trim(); }
        case "education": {
            const x = item as ResumeData["education"][number];
            const extra = [t(x.gpa) && `GPA ${t(x.gpa)}`, t(x.minor) && `Minor in ${t(x.minor)}`, t(x.details)].filter(Boolean).join("\n");
            return `Education: ${t(x.degree)}, ${t(x.institution)}\n${extra}`.trim();
        }
        case "skills": { const x = item as ResumeData["skills"][number]; return `Skills (${t(x.category)}): ${t(x.items)}`; }
        case "projects": { const x = item as ResumeData["projects"][number]; return `Project: ${t(x.title)}\n${t(x.stack) ? `Stack: ${t(x.stack)}\n` : ""}${bullets(x.description)}`.trim(); }
        case "certifications": { const x = item as ResumeData["certifications"][number]; return `Certification: ${t(x.name)}${paren(t(x.issuer))}`; }
        case "awards": { const x = item as ResumeData["awards"][number]; return `Award: ${t(x.title)}${paren(t(x.issuer))}\n${t(x.description)}`.trim(); }
        case "volunteering": { const x = item as ResumeData["volunteering"][number]; return `Volunteering / leadership: ${t(x.role)} at ${t(x.organization)}\n${bullets(x.description)}`.trim(); }
        case "publications": { const x = item as ResumeData["publications"][number]; return `Publication: ${t(x.title)}\n${t(x.venue) ? `Venue: ${t(x.venue)}\n` : ""}${t(x.authors) ? `Authors: ${t(x.authors)}` : ""}`.trim(); }
        case "languages": { const x = item as ResumeData["languages"][number]; return `Spoken language: ${t(x.language)}${paren(t(x.proficiency))}`; }
        case "custom": { const x = item as ResumeData["custom"][number]; return `${t(x.section) || "Other"}: ${t(x.title)}${t(x.subtitle) ? ` (${t(x.subtitle)})` : ""}\n${bullets(x.description)}`.trim(); }
    }
    return "";
}

export function profileText(p: PersonalInfo): string {
    return [t(p.headline) && `Headline: ${t(p.headline)}`, t(p.summary) && `Summary: ${t(p.summary)}`].filter(Boolean).join("\n");
}

/**
 * Background the tagger gets with every chunk: who the candidate is (headline,
 * degrees, summary). Items are tagged on their own text, but the context lets
 * the model resolve ambiguity and file items under the candidate's field.
 * Not hashed: it never makes an item stale.
 */
export function tagContext(data: ResumeData): string {
    const p = data.personalInfo;
    const degrees = data.education
        .map(e => [t(e.degree), t(e.institution)].filter(Boolean).join(", ") + (t(e.minor) ? ` (minor: ${t(e.minor)})` : ""))
        .filter(Boolean);
    const lines = [
        t(p.headline) && `Headline: ${t(p.headline)}`,
        degrees.length > 0 && `Education: ${degrees.join(" | ")}`,
        t(p.summary) && `Summary: ${t(p.summary).slice(0, 600)}`,
    ].filter(Boolean) as string[];
    return lines.join("\n").slice(0, 1500);
}

export function profileHashOf(p: PersonalInfo): string {
    return stableHash(`profile|${JSON.stringify([t(p.headline), t(p.summary)])}`);
}

export function isStale<K extends ResumeListKey>(key: K, item: ResumeData[K][number]): boolean {
    return hasContent(key, item) && item.tagsHash !== contentHashOf(key, item);
}

export function isProfileStale(data: ResumeData): boolean {
    return profileText(data.personalInfo) !== "" && data.profileTagsHash !== profileHashOf(data.personalInfo);
}

/** Every item (and the profile) whose tags no longer match its content. */
export function staleInputs(data: ResumeData): TagInput[] {
    const out: TagInput[] = [];
    if (isProfileStale(data)) out.push({ id: PROFILE_ID, section: "profile", text: profileText(data.personalInfo) });
    for (const key of RESUME_LIST_KEYS) {
        for (const item of data[key]) {
            if (isStale(key, item)) out.push({ id: item.id, section: key, text: itemText(key, item) });
        }
    }
    return out;
}

export function staleCount(data: ResumeData): number {
    return staleInputs(data).length;
}

/** Inputs for every item regardless of staleness (used by "analyse everything" flows). */
export function allInputs(data: ResumeData): TagInput[] {
    const out: TagInput[] = [];
    if (profileText(data.personalInfo) !== "") out.push({ id: PROFILE_ID, section: "profile", text: profileText(data.personalInfo) });
    for (const key of RESUME_LIST_KEYS) {
        for (const item of data[key]) {
            if (hasContent(key, item)) out.push({ id: item.id, section: key, text: itemText(key, item) });
        }
    }
    return out;
}

/** Applies freshly extracted tags to a draft (pure): sets tags + tagsHash so the items are no longer stale. */
export function applyTags(data: ResumeData, tagsById: Record<string, ResumeData["profileTags"]>): ResumeData {
    const next: ResumeData = { ...data };
    if (tagsById[PROFILE_ID]) {
        next.profileTags = tagsById[PROFILE_ID];
        next.profileTagsHash = profileHashOf(data.personalInfo);
    }
    for (const key of RESUME_LIST_KEYS) {
        (next[key] as unknown[]) = (data[key] as ResumeData[typeof key][number][]).map(item =>
            tagsById[item.id] ? { ...item, tags: tagsById[item.id], tagsHash: contentHashOf(key, item) } : item,
        );
    }
    return next;
}
