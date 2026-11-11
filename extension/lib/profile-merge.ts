// The LinkedIn parser's (lib/profile-extract.ts) confidence signal: what it read, what it could not, and
// when its result should not be trusted on its own. Pure.

import type { ImportEnvelope } from "../../src/lib/import/envelope";

type SectionKey = Exclude<keyof ImportEnvelope, "personalInfo" | "links">;
/** Envelope parts a capture can report as unread ("summary" = the About card). */
export type ReadKey = SectionKey | "summary";

const SECTION_KEYS: SectionKey[] = ["workExperience", "education", "skills", "projects", "certifications", "awards", "volunteering", "publications", "languages", "custom"];
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
