// src/lib/typst/doc.ts
// The JSON contract between the app and the Typst templates. This is the ONLY
// place the app shapes resume data for Typst: it filters `isSelected`, formats
// dates, splits bullet text, and guarantees every field is a string (never
// null/undefined) so templates can simply test `x != ""`.
//
// Templates receive this object via `sys.inputs.resume` and must not do any
// filtering or date logic of their own; they are pure styling.

import { formatDateRange, formatMonthYear } from "@/lib/dates";
import { bulletEntries, bulletLines, skillEntries, visible } from "@/lib/sub-items";
import type { PersonalInfo, ResumeData, ResumeListKey } from "@/types/schema";
import { orderedItems } from "@/lib/layout/order";
import { defaultLayout, itemLayout, sectionSpacing } from "@/lib/layout/presets";
import type { ResumeLayout, SectionId } from "@/lib/layout/types";
import { ACCENTS, FONT_PAIRS, type PaperId } from "@/lib/layout/theme";
import type { TemplateId } from "@/lib/typst/templates";

/** Per-entry layout, present on every list entry (pt / booleans). */
export interface TypstItemLayout {
    space_after: number;
    break_before: boolean;
    keep: boolean;
}

export interface TypstSectionLayout {
    above: number;
    below: number;
    gap: number;
    indent: number;
}

export interface TypstLayout {
    /** Template section keys in print order (header is always first). */
    order: TypstSectionKey[];
    page: { margin: number; size: number; leading: number };
    sections: Record<TypstSectionKey, TypstSectionLayout>;
    /** Template id plus the overrides templates read (`""` = the template's own choice). */
    theme: { template: TemplateId; accent: string; heading_font: string; body_font: string; paper: PaperId };
}

export type TypstSectionKey =
    | "summary" | "education" | "skills" | "projects" | "experience" | "volunteering" | "publications" | "awards" | "certifications" | "languages";

/** Editor section id -> template key. */
export const TYPST_SECTION_KEY: Record<SectionId, TypstSectionKey> = {
    summary: "summary",
    workExperience: "experience",
    education: "education",
    skills: "skills",
    projects: "projects",
    certifications: "certifications",
    awards: "awards",
    volunteering: "volunteering",
    publications: "publications",
    languages: "languages",
};

export interface TypstHeader {
    name: string;
    tagline: string;
    location: string;
    phone: string;
    email: string;
    github: string;
    linkedin: string;
    website: string;
}

export interface TypstEducation {
    title: string;
    institution: string;
    date: string;
    gpa: string;
    minor: string;
    details: string;
}

export interface TypstSkill {
    label: string;
    value: string;
}

export interface TypstProject {
    title: string;
    stack: string;
    date: string;
    link: string;
    bullets: string[];
}

export interface TypstExperience {
    title: string;
    company: string;
    date: string;
    bullets: string[];
}

export interface TypstCertification {
    name: string;
    issuer: string;
    year: string;
}

export interface TypstAward {
    title: string;
    issuer: string;
    date: string;
    description: string;
}

export interface TypstVolunteering {
    title: string;
    organization: string;
    date: string;
    bullets: string[];
}

export interface TypstPublication {
    title: string;
    venue: string;
    date: string;
    link: string;
    authors: string;
}

export interface TypstLanguage {
    language: string;
    proficiency: string;
}

type WithLayout<T> = T & TypstItemLayout;

export interface TypstResumeDoc {
    header: TypstHeader;
    summary: string;
    education: WithLayout<TypstEducation>[];
    skills: WithLayout<TypstSkill>[];
    projects: WithLayout<TypstProject>[];
    experience: WithLayout<TypstExperience>[];
    volunteering: WithLayout<TypstVolunteering>[];
    publications: WithLayout<TypstPublication>[];
    awards: WithLayout<TypstAward>[];
    certifications: WithLayout<TypstCertification>[];
    languages: WithLayout<TypstLanguage>[];
    layout: TypstLayout;
}

function typstLayout(layout: ResumeLayout): TypstLayout {
    const sections = {} as Record<TypstSectionKey, TypstSectionLayout>;
    for (const id of Object.keys(TYPST_SECTION_KEY) as SectionId[]) {
        const sp = sectionSpacing(layout, id);
        sections[TYPST_SECTION_KEY[id]] = { above: sp.above, below: sp.below, gap: sp.itemGap, indent: sp.indent };
    }
    return {
        order: layout.sectionOrder.map(id => TYPST_SECTION_KEY[id]),
        page: { margin: layout.page.marginMm, size: layout.page.fontPt, leading: layout.page.leadingEm },
        sections,
        theme: {
            template: layout.theme.templateId,
            accent: ACCENTS[layout.theme.accent].hex,
            heading_font: FONT_PAIRS[layout.theme.font].heading,
            body_font: FONT_PAIRS[layout.theme.font].body,
            paper: layout.theme.paper,
        },
    };
}

const s = (v: string | null | undefined): string => (v ?? "").trim();

/** Newline-separated text -> trimmed, non-empty bullet strings (leading "- " / "• " stripped). */
export function toBullets(text: string | null | undefined): string[] {
    return bulletLines(text);
}

/** Bullets minus the ones switched off individually. */
const shownBullets = (text: string, hidden: readonly string[] | undefined) =>
    visible(bulletEntries(toBullets(text)), hidden).map(e => e.label);

export function toTypstDoc(data: ResumeData): TypstResumeDoc {
    const p = data.personalInfo;
    const layout = data.layout ?? defaultLayout();
    /** Selected items of a section in print order, each with its layout fields. */
    const pick = <K extends ResumeListKey>(key: K) =>
        orderedItems(key, data[key] as ResumeData[K][number][], layout).filter(x => x.isSelected);
    const lay = (id: string): TypstItemLayout => {
        const l = itemLayout(layout, id);
        return { space_after: l.spaceAfter, break_before: l.breakBefore, keep: l.keepTogether };
    };
    return {
        header: {
            name: [s(p.firstName), s(p.lastName)].filter(Boolean).join(" "),
            tagline: s(p.headline),
            location: s(p.location),
            phone: s(p.phone),
            email: s(p.email),
            github: s(p.github),
            linkedin: s(p.linkedin),
            website: s(p.website),
        },
        summary: s(p.summary),
        education: pick("education").map(e => ({
            title: s(e.degree),
            institution: s(e.institution),
            date: formatDateRange(e.startDate, e.endDate),
            gpa: s(e.gpa),
            minor: s(e.minor),
            details: s(e.details),
            ...lay(e.id),
        })),
        skills: pick("skills").flatMap(k => {
            const all = skillEntries(k.items);
            const shown = visible(all, k.hidden);
            // A category whose skills are all switched off disappears.
            return all.length > 0 && shown.length === 0 ? [] : [{ label: s(k.category), value: shown.map(e => e.label).join(", "), ...lay(k.id) }];
        }),
        projects: pick("projects").map(pr => ({
            title: s(pr.title),
            stack: s(pr.stack),
            date: formatDateRange(pr.startDate, pr.endDate),
            link: s(pr.link),
            bullets: shownBullets(pr.description, pr.hidden),
            ...lay(pr.id),
        })),
        experience: pick("workExperience").map(x => ({
            title: s(x.title),
            company: s(x.company),
            date: formatDateRange(x.startDate, x.endDate),
            bullets: shownBullets(x.description, x.hidden),
            ...lay(x.id),
        })),
        volunteering: pick("volunteering").map(v => ({
            title: s(v.role),
            organization: s(v.organization),
            date: formatDateRange(v.startDate, v.endDate),
            bullets: shownBullets(v.description, v.hidden),
            ...lay(v.id),
        })),
        publications: pick("publications").map(pub => ({
            title: s(pub.title),
            venue: s(pub.venue),
            date: formatMonthYear(pub.date),
            link: s(pub.link),
            authors: s(pub.authors),
            ...lay(pub.id),
        })),
        awards: pick("awards").map(a => ({
            title: s(a.title),
            issuer: s(a.issuer),
            date: formatMonthYear(a.date),
            description: s(a.description),
            ...lay(a.id),
        })),
        certifications: pick("certifications").map(c => ({ name: s(c.name), issuer: s(c.issuer), year: s(c.year), ...lay(c.id) })),
        languages: pick("languages").map(l => ({ language: s(l.language), proficiency: s(l.proficiency), ...lay(l.id) })),
        layout: typstLayout(layout),
    };
}

/** "First_Last_Resume.pdf" with unsafe characters stripped; "Resume.pdf" if no name. */
export function pdfFileName(p: PersonalInfo): string {
    const clean = (v: string) => v.trim().replace(/[^A-Za-z0-9-]+/g, "");
    const parts = [clean(p.firstName), clean(p.lastName)].filter(Boolean);
    return `${[...parts, "Resume"].join("_")}.pdf`;
}
