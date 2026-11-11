// When the LinkedIn parser (lib/profile-extract.ts) is unsure, and how its result is combined with the
// AI fallback's (/api/ext/profile/analyse). Pure: used by the profile content script (whether to send the
// page text) and the background session (lib/linkedin-session.ts). The parser stays the source for
// everything it read confidently; the AI fills only what it could not read.

import type { ImportEnvelope } from "../../src/lib/import/envelope";

type SectionKey = Exclude<keyof ImportEnvelope, "personalInfo" | "links">;
/** Envelope parts a capture can report as unread ("summary" = the About card). */
export type ReadKey = SectionKey | "summary";

const SECTION_KEYS: SectionKey[] = ["workExperience", "education", "skills", "projects", "certifications", "awards", "volunteering", "publications", "languages", "custom"];
const LABELS: Record<ReadKey, string> = {
    summary: "About", workExperience: "Experience", education: "Education", skills: "Skills", projects: "Projects",
    certifications: "Licenses & certifications", awards: "Honors & awards", volunteering: "Volunteering",
    publications: "Publications", languages: "Languages", custom: "Other sections",
};

/** The parser's result: the envelope, warnings, what it could not read, and whether the top card (name) was read. */
export interface CaptureResult {
    data: ImportEnvelope;
    warnings: string[];
    unread: ReadKey[];
    topCard: boolean;
}

const filled = (v: unknown) => typeof v === "string" && v.trim() !== "";
const sectionCount = (data: ImportEnvelope) => SECTION_KEYS.reduce((n, k) => n + (data[k]?.length ?? 0), 0);

/** Anything worth importing: a name, a summary or one item. */
export function hasContent(data: ImportEnvelope): boolean {
    const p = data.personalInfo ?? {};
    return filled(p.name) || filled(p.firstName) || filled(p.summary) || sectionCount(data) > 0;
}

/** The parser is unsure: no top card, a recognised card it could not read, or nothing but the top card. */
export function needsAnalysis(c: CaptureResult): boolean {
    return !c.topCard || c.unread.length > 0 || (sectionCount(c.data) === 0 && !filled(c.data.personalInfo?.summary));
}

const NAME_FIELDS = new Set(["name", "firstName", "lastName"]);

/**
 * The parser's envelope with the AI's filling what it could not read: a section it reported unread or
 * found empty, personal fields it left blank (the name only when the top card was unreadable), the About
 * text when that card was unreadable. Warnings about sections the AI filled are replaced by one note.
 */
export function mergeAnalysis(c: CaptureResult, ai: ImportEnvelope): { data: ImportEnvelope; warnings: string[] } {
    const unread = new Set(c.unread);
    const used: string[] = [];
    const data: ImportEnvelope = { ...c.data };

    const personal = { ...(c.data.personalInfo ?? {}) };
    const takeName = !c.topCard;
    for (const [key, value] of Object.entries(ai.personalInfo ?? {}) as [keyof typeof personal, string | undefined][]) {
        if (!filled(value)) continue;
        if (NAME_FIELDS.has(key) && !takeName) continue;
        // The model splits the name; the parser's single "name" would lose to its parts.
        if (NAME_FIELDS.has(key) && takeName && filled(personal.name)) continue;
        if (key === "summary" ? filled(personal.summary) && !unread.has("summary") : filled(personal[key])) continue;
        personal[key] = value;
        if (key === "summary") used.push(LABELS.summary);
    }
    if (takeName && Object.keys(personal).some(k => NAME_FIELDS.has(k) && filled(personal[k as keyof typeof personal]))) used.unshift("your name and headline");
    data.personalInfo = personal;
    if (!data.links?.length && ai.links?.length) data.links = ai.links;

    for (const key of SECTION_KEYS) {
        const mine = c.data[key] ?? [];
        const theirs = ai[key] ?? [];
        if (theirs.length === 0 || (mine.length > 0 && !unread.has(key))) continue;
        (data as Record<SectionKey, unknown[]>)[key] = theirs;
        used.push(LABELS[key]);
    }

    const replaced = new Set(used);
    const warnings = c.warnings.filter(w => ![...replaced].some(label => w.startsWith(`Could not read ${label}`) || w.startsWith(`Could not read part of ${label}`)));
    if (used.length > 0) warnings.unshift(`Read with AI: ${[...new Set(used)].join(", ")}. Check the details.`);
    return { data, warnings };
}

/** Warning kept with a partial parse when the AI fallback failed. */
export const aiFailedWarning = (reason: string) =>
    `Some parts of your profile could not be read, and reading them with AI failed (${reason.replace(/\.$/, "")}). Check them against LinkedIn.`;
