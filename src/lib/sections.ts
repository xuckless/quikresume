// src/lib/sections.ts
// Pure helpers mapping editor sections (ResumeData keys) to Firestore
// collection names and human labels. Shared by import review rows, tag
// tables, proposals and variants.

import type { ResumeData, ResumeListKey } from "@/types/schema";
import { formatDateRange, formatMonthYear } from "@/lib/dates";

export type CollectionName =
    | "experience" | "education" | "skills" | "projects" | "certifications"
    | "awards" | "volunteering" | "publications" | "languages" | "custom";

export const SECTION_COLLECTION: Record<ResumeListKey, CollectionName> = {
    workExperience: "experience",
    education: "education",
    skills: "skills",
    projects: "projects",
    certifications: "certifications",
    awards: "awards",
    volunteering: "volunteering",
    publications: "publications",
    languages: "languages",
    custom: "custom",
};

export const COLLECTION_SECTION: Record<CollectionName, ResumeListKey> = {
    experience: "workExperience",
    education: "education",
    skills: "skills",
    projects: "projects",
    certifications: "certifications",
    awards: "awards",
    volunteering: "volunteering",
    publications: "publications",
    languages: "languages",
    custom: "custom",
};

export const COLLECTION_NAMES = Object.keys(COLLECTION_SECTION) as CollectionName[];

export const SECTION_LABEL: Record<ResumeListKey, string> = {
    workExperience: "Experience",
    education: "Education",
    skills: "Skills",
    projects: "Projects",
    certifications: "Certifications",
    awards: "Awards & Honors",
    volunteering: "Volunteering & Leadership",
    publications: "Publications",
    languages: "Languages",
    custom: "Custom sections",
};

/** What saveResumeData writes for empty required fields. Import matching treats these as empty. */
export const PLACEHOLDER = {
    role: "Untitled Role",
    company: "Unknown Company",
    program: "Untitled Program",
    institution: "Unknown Institution",
    skillCategory: "General",
    project: "Untitled Project",
    certification: "Untitled Certification",
    award: "Untitled Award",
    organization: "Unknown Organization",
    publication: "Untitled Publication",
    language: "Unknown Language",
    customEntry: "Untitled Entry",
    customSection: "Other",
} as const;

export interface ItemLabel { title: string; subtitle: string; meta: string }

/** Title / subtitle / date-ish meta for any list item, for compact rows. */
export function itemLabel<K extends ResumeListKey>(key: K, item: ResumeData[K][number]): ItemLabel {
    switch (key) {
        case "workExperience": { const x = item as ResumeData["workExperience"][number]; return { title: x.title, subtitle: x.company, meta: formatDateRange(x.startDate, x.endDate) }; }
        case "education": { const x = item as ResumeData["education"][number]; return { title: x.degree, subtitle: x.institution, meta: formatDateRange(x.startDate, x.endDate) }; }
        case "skills": { const x = item as ResumeData["skills"][number]; return { title: x.category, subtitle: x.items, meta: "" }; }
        case "projects": { const x = item as ResumeData["projects"][number]; return { title: x.title, subtitle: x.stack, meta: formatDateRange(x.startDate, x.endDate) }; }
        case "certifications": { const x = item as ResumeData["certifications"][number]; return { title: x.name, subtitle: x.issuer, meta: x.year }; }
        case "awards": { const x = item as ResumeData["awards"][number]; return { title: x.title, subtitle: x.issuer, meta: formatMonthYear(x.date) }; }
        case "volunteering": { const x = item as ResumeData["volunteering"][number]; return { title: x.role, subtitle: x.organization, meta: formatDateRange(x.startDate, x.endDate) }; }
        case "publications": { const x = item as ResumeData["publications"][number]; return { title: x.title, subtitle: [x.authors, x.venue].filter(Boolean).join(" · "), meta: formatMonthYear(x.date) }; }
        case "languages": { const x = item as ResumeData["languages"][number]; return { title: x.language, subtitle: x.proficiency, meta: "" }; }
        case "custom": { const x = item as ResumeData["custom"][number]; return { title: x.title, subtitle: [x.subtitle, x.section].filter(Boolean).join(" · "), meta: formatDateRange(x.startDate, x.endDate) }; }
    }
    return { title: "", subtitle: "", meta: "" };
}

/**
 * Just the item's own name ("Technical skills", "Site Operator"), for compact rows. Unlike
 * `itemTitle` this never appends the subtitle, which for skills is the whole joined item list.
 */
export function itemShortTitle<K extends ResumeListKey>(key: K, item: ResumeData[K][number]): string {
    return itemLabel(key, item).title || "Untitled";
}

/** One-line label: "Senior Engineer · Acme". */
export function itemTitle<K extends ResumeListKey>(key: K, item: ResumeData[K][number]): string {
    const { title, subtitle } = itemLabel(key, item);
    return [title, subtitle].filter(Boolean).join(" · ") || "Untitled";
}

/** Sort key for recency (newest first): the item's most recent date, "" when none. */
export function itemRecency<K extends ResumeListKey>(key: K, item: ResumeData[K][number]): string {
    const x = item as unknown as Record<string, unknown>;
    const end = typeof x.endDate === "string" ? x.endDate : "";
    if (end === "Present") return "9999";
    return end || (typeof x.startDate === "string" ? x.startDate : "") || (typeof x.date === "string" ? x.date : "") || (typeof x.year === "string" ? x.year : "");
}
