// src/lib/layout/presets.ts
// Layout defaults, presets, clamping and normalisation of stored/legacy layouts.
// "normal" reproduces the ledger template's original hard-coded values.

// No value imports from @/types/schema: schema.ts imports defaultLayout from here.
import type { ResumeListKey } from "@/types/schema";
import type { ItemLayout, PageSettings, Preset, ResumeLayout, SectionId, SectionSpacing } from "./types";
import { DEFAULT_THEME, normalizeTheme } from "./theme";

/** The ledger template's original order. */
export const DEFAULT_SECTION_ORDER: SectionId[] = [
    "summary", "education", "skills", "projects", "workExperience", "volunteering", "publications", "awards", "certifications", "languages", "custom",
];

export const SECTION_IDS: ReadonlySet<SectionId> = new Set(DEFAULT_SECTION_ORDER);

/**
 * Sections printed as stacked entries. Only these use the gap between items and
 * the per-item overrides; skills, certifications and languages print as one
 * grid / line and the summary as a paragraph.
 */
export const ENTRY_SECTIONS: ReadonlySet<SectionId> = new Set(["workExperience", "education", "projects", "volunteering", "publications", "awards", "custom"]);

export const PAGE_PRESETS: Record<Exclude<Preset, "custom">, Omit<PageSettings, "preset">> = {
    compact: { marginMm: 12, fontPt: 10, leadingEm: 0.45 },
    normal: { marginMm: 16, fontPt: 10.5, leadingEm: 0.55 },
    relaxed: { marginMm: 20, fontPt: 11, leadingEm: 0.65 },
};

export const SECTION_PRESETS: Record<Exclude<Preset, "custom">, Omit<SectionSpacing, "preset">> = {
    compact: { above: 2, below: 3, itemGap: 3, indent: 0 },
    normal: { above: 4, below: 6, itemGap: 6, indent: 0 },
    relaxed: { above: 8, below: 10, itemGap: 10, indent: 0 },
};

export const RANGES = {
    marginMm: { min: 8, max: 30, step: 1, unit: "mm", label: "Page margins" },
    fontPt: { min: 9, max: 12, step: 0.5, unit: "pt", label: "Font size" },
    leadingEm: { min: 0.3, max: 1, step: 0.05, unit: "em", label: "Line spacing" },
    above: { min: 0, max: 24, step: 1, unit: "pt", label: "Space above" },
    below: { min: 0, max: 24, step: 1, unit: "pt", label: "Space below" },
    itemGap: { min: 0, max: 24, step: 1, unit: "pt", label: "Gap between items" },
    indent: { min: 0, max: 36, step: 1, unit: "pt", label: "Left/right indent" },
    spaceAfter: { min: 0, max: 48, step: 1, unit: "pt", label: "Extra space after" },
} as const;

export type RangeKey = keyof typeof RANGES;

export function clampTo(key: RangeKey, v: unknown, fallback: number): number {
    const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
    const { min, max } = RANGES[key];
    return Math.min(max, Math.max(min, n));
}

export const DEFAULT_PAGE: PageSettings = { preset: "normal", ...PAGE_PRESETS.normal };
export const DEFAULT_SECTION_SPACING: SectionSpacing = { preset: "normal", ...SECTION_PRESETS.normal };

export const MAX_HEADING = 40;

export function defaultLayout(): ResumeLayout {
    return { sectionOrder: [...DEFAULT_SECTION_ORDER], itemOrder: {}, page: { ...DEFAULT_PAGE }, sections: {}, items: {}, theme: { ...DEFAULT_THEME }, headings: {} };
}

export const sectionSpacing = (layout: ResumeLayout, id: SectionId): SectionSpacing => layout.sections[id] ?? DEFAULT_SECTION_SPACING;
export const itemLayout = (layout: ResumeLayout, id: string): Required<ItemLayout> => ({
    spaceAfter: layout.items[id]?.spaceAfter ?? 0,
    breakBefore: layout.items[id]?.breakBefore ?? false,
    keepTogether: layout.items[id]?.keepTogether ?? true,
});

const isPreset = (v: unknown): v is Preset => v === "compact" || v === "normal" || v === "relaxed" || v === "custom";
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Fills defaults, drops unknown sections / malformed values, appends sections missing from the order. */
export function normalizeLayout(raw: unknown): ResumeLayout {
    const r = isObj(raw) ? raw : {};
    const order: SectionId[] = [];
    if (Array.isArray(r.sectionOrder)) {
        for (const id of r.sectionOrder) if (SECTION_IDS.has(id as SectionId) && !order.includes(id as SectionId)) order.push(id as SectionId);
    }
    for (const id of DEFAULT_SECTION_ORDER) if (!order.includes(id)) order.push(id);

    const itemOrder: ResumeLayout["itemOrder"] = {};
    if (isObj(r.itemOrder)) {
        for (const key of DEFAULT_SECTION_ORDER) {
            if (key === "summary") continue;
            const ids = r.itemOrder[key];
            if (Array.isArray(ids)) itemOrder[key] = [...new Set(ids.filter((x): x is string => typeof x === "string"))];
        }
    }

    const p = isObj(r.page) ? r.page : {};
    const page: PageSettings = {
        preset: isPreset(p.preset) ? p.preset : "normal",
        marginMm: clampTo("marginMm", p.marginMm, DEFAULT_PAGE.marginMm),
        fontPt: clampTo("fontPt", p.fontPt, DEFAULT_PAGE.fontPt),
        leadingEm: clampTo("leadingEm", p.leadingEm, DEFAULT_PAGE.leadingEm),
    };

    const sections: ResumeLayout["sections"] = {};
    if (isObj(r.sections)) {
        for (const id of DEFAULT_SECTION_ORDER) {
            const s = r.sections[id];
            if (!isObj(s)) continue;
            sections[id] = {
                preset: isPreset(s.preset) ? s.preset : "normal",
                above: clampTo("above", s.above, DEFAULT_SECTION_SPACING.above),
                below: clampTo("below", s.below, DEFAULT_SECTION_SPACING.below),
                itemGap: clampTo("itemGap", s.itemGap, DEFAULT_SECTION_SPACING.itemGap),
                indent: clampTo("indent", s.indent, DEFAULT_SECTION_SPACING.indent),
            };
        }
    }

    const items: ResumeLayout["items"] = {};
    if (isObj(r.items)) {
        for (const [id, v] of Object.entries(r.items)) {
            if (!isObj(v)) continue;
            const it: ItemLayout = {};
            if (typeof v.spaceAfter === "number" && v.spaceAfter > 0) it.spaceAfter = clampTo("spaceAfter", v.spaceAfter, 0);
            if (v.breakBefore === true) it.breakBefore = true;
            if (v.keepTogether === false) it.keepTogether = false;
            if (Object.keys(it).length > 0) items[id] = it;
        }
    }

    const headings: ResumeLayout["headings"] = {};
    if (isObj(r.headings)) {
        for (const id of DEFAULT_SECTION_ORDER) {
            const h = r.headings[id];
            if (typeof h === "string" && h.trim()) headings[id] = h.replace(/[\u0000-\u001f]/g, "").trim().slice(0, MAX_HEADING);
        }
    }

    return { sectionOrder: order, itemOrder, page, sections, items, theme: normalizeTheme(r.theme), headings };
}

/** Drops item ids that no longer exist and renames temp ids to their saved ids. */
export function pruneLayout(layout: ResumeLayout, existingIds: ReadonlySet<string>, rename: (id: string) => string = id => id): ResumeLayout {
    const itemOrder: ResumeLayout["itemOrder"] = {};
    for (const [key, ids] of Object.entries(layout.itemOrder) as [ResumeListKey, string[]][]) {
        itemOrder[key] = ids.filter(id => existingIds.has(id)).map(rename);
    }
    const items: ResumeLayout["items"] = {};
    for (const [id, v] of Object.entries(layout.items)) if (existingIds.has(id)) items[rename(id)] = v;
    return { ...layout, itemOrder, items };
}
