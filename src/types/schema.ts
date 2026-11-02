// src/types/schema.ts
// The editor / preview model. This is what ResumeForm edits, what
// saveResumeData receives, and what toTypstDoc turns into a Typst document.
//
// Date conventions:
//   startDate: "YYYY-MM-DD" | ""
//   endDate:   "YYYY-MM-DD" | "Present" | ""
//   description: newline-separated bullet points
//   hidden:      keys of bullets / skills switched off individually
//
// Every list item also carries smart tags (see src/lib/tags): `tags` are the
// last extracted tags and `tagsHash` the content hash they were extracted
// from; when it differs from the current content hash the item is "stale".

import type { Tag } from "@/lib/tags/types";
import type { ResumeLayout } from "@/lib/layout/types";
import { defaultLayout } from "@/lib/layout/presets";

export interface PersonalInfo {
    firstName: string;
    lastName: string;
    /** One-line tagline under the name, e.g. "B.S. Computer Science, Class of 2026". */
    headline: string;
    email: string;
    phone: string;
    location: string;
    github: string;
    linkedin: string;
    website: string;
    summary: string;
}

export interface WorkExperience {
    id: string;
    title: string;
    company: string;
    startDate: string;
    endDate: string;
    description: string;
    /** Keys of switched-off bullets (see src/lib/sub-items.ts). */
    hidden: string[];
    isSelected: boolean;
    tags: Tag[];
    tagsHash: string | null;
}

export interface Education {
    id: string;
    degree: string;
    institution: string;
    startDate: string;
    endDate: string;
    gpa: string;
    minor: string;
    /** Coursework, honors, dean's list, etc. */
    details: string;
    isSelected: boolean;
    tags: Tag[];
    tagsHash: string | null;
}

export interface SkillCategory {
    id: string;
    category: string;
    items: string;
    /** Keys of switched-off skills (see src/lib/sub-items.ts). */
    hidden: string[];
    isSelected: boolean;
    tags: Tag[];
    tagsHash: string | null;
}

export interface Project {
    id: string;
    title: string;
    /** Tech stack / meta line, e.g. "PyTorch, FastAPI, Docker". */
    stack: string;
    link: string;
    startDate: string;
    endDate: string;
    description: string;
    /** Keys of switched-off bullets (see src/lib/sub-items.ts). */
    hidden: string[];
    isSelected: boolean;
    tags: Tag[];
    tagsHash: string | null;
}

export interface Certification {
    id: string;
    name: string;
    issuer: string;
    year: string;
    /** Licence / registration / credential number ("" = none). Printed after the issuer. */
    credentialId: string;
    /** Expiry, "YYYY" or "YYYY-MM" ("" = none or doesn't expire). */
    expires: string;
    isSelected: boolean;
    tags: Tag[];
    tagsHash: string | null;
}

export interface Award {
    id: string;
    title: string;
    issuer: string;
    /** "YYYY-MM-DD" | "" */
    date: string;
    description: string;
    isSelected: boolean;
    tags: Tag[];
    tagsHash: string | null;
}

export interface Volunteering {
    id: string;
    role: string;
    organization: string;
    startDate: string;
    endDate: string;
    description: string;
    /** Keys of switched-off bullets (see src/lib/sub-items.ts). */
    hidden: string[];
    isSelected: boolean;
    tags: Tag[];
    tagsHash: string | null;
}

export interface Publication {
    id: string;
    title: string;
    /** Journal, conference or publisher. */
    venue: string;
    /** "YYYY-MM-DD" | "" */
    date: string;
    link: string;
    authors: string;
    isSelected: boolean;
    tags: Tag[];
    tagsHash: string | null;
}

export interface Language {
    id: string;
    language: string;
    /** e.g. "Native", "Fluent", "B2". */
    proficiency: string;
    isSelected: boolean;
    tags: Tag[];
    tagsHash: string | null;
}

export interface ResumeData {
    personalInfo: PersonalInfo;
    /** Tags extracted from the headline + summary (kept outside PersonalInfo, which is a flat string map). */
    profileTags: Tag[];
    profileTagsHash: string | null;
    workExperience: WorkExperience[];
    education: Education[];
    skills: SkillCategory[];
    projects: Project[];
    certifications: Certification[];
    awards: Award[];
    volunteering: Volunteering[];
    publications: Publication[];
    languages: Language[];
    /** Section order, manual item order and spacing (users/{uid}/meta/layout). */
    layout: ResumeLayout;
}

/** The list-valued keys of ResumeData. */
export type ResumeListKey = Exclude<keyof ResumeData, "personalInfo" | "profileTags" | "profileTagsHash" | "layout">;

export const RESUME_LIST_KEYS: ResumeListKey[] = [
    "workExperience",
    "education",
    "skills",
    "projects",
    "certifications",
    "awards",
    "volunteering",
    "publications",
    "languages",
];

export function emptyPersonalInfo(): PersonalInfo {
    return {
        firstName: "",
        lastName: "",
        headline: "",
        email: "",
        phone: "",
        location: "",
        github: "",
        linkedin: "",
        website: "",
        summary: "",
    };
}

export function emptyResumeData(): ResumeData {
    return {
        personalInfo: emptyPersonalInfo(),
        profileTags: [],
        profileTagsHash: null,
        workExperience: [],
        education: [],
        skills: [],
        projects: [],
        certifications: [],
        awards: [],
        volunteering: [],
        publications: [],
        languages: [],
        layout: defaultLayout(),
    };
}
