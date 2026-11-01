// src/lib/layout/types.ts
// The résumé layout: section order, manual item order, page settings, per-section
// spacing and per-item overrides. One global working layout lives in
// users/{uid}/meta/layout (and on ResumeData.layout); variants snapshot it.

import type { ResumeListKey } from "@/types/schema";
import type { ResumeTheme } from "./theme";

export type SectionId = "summary" | ResumeListKey;
export type Preset = "compact" | "normal" | "relaxed" | "custom";

/** All values in pt. */
export interface SectionSpacing {
    preset: Preset;
    /** Space before the section heading. */
    above: number;
    /** Space after the section body. */
    below: number;
    /** Space between entries. */
    itemGap: number;
    /** Left/right inset of the section body. */
    indent: number;
}

export interface PageSettings {
    preset: Preset;
    marginMm: number;
    fontPt: number;
    leadingEm: number;
}

export interface ItemLayout {
    /** Extra pt after this entry. */
    spaceAfter?: number;
    /** Start this entry on a new page. */
    breakBefore?: boolean;
    /** Never split this entry across pages (default true). */
    keepTogether?: boolean;
}

export interface ResumeLayout {
    sectionOrder: SectionId[];
    /** Manual item order per section; absent = sorted by date (newest first). */
    itemOrder: Partial<Record<ResumeListKey, string[]>>;
    page: PageSettings;
    /** Absent = the "normal" preset. */
    sections: Partial<Record<SectionId, SectionSpacing>>;
    /** Per-item overrides by item id; absent = defaults. */
    items: Record<string, ItemLayout>;
    /** Template, accent, fonts and paper. */
    theme: ResumeTheme;
}
