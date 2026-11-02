// src/lib/layout/theme.ts
// Résumé look: template, accent colour, font pair and paper size. Lives on ResumeLayout.theme, so
// the working layout (meta/layout) and every variant snapshot carry it. Pure; no value imports from
// @/types/schema (see presets.ts).

import { DEFAULT_TEMPLATE, isTemplateId, type TemplateId } from "@/lib/typst/templates";

/** "template" = the template's own accent. */
export const ACCENTS = {
    template: { label: "Template default", hex: "" },
    green: { label: "Forest", hex: "#1f5e3a" },
    navy: { label: "Navy", hex: "#1e3a6e" },
    burgundy: { label: "Burgundy", hex: "#7a2233" },
    teal: { label: "Teal", hex: "#0f5f63" },
    slate: { label: "Slate", hex: "#3d4757" },
    black: { label: "Black", hex: "#1a1a1a" },
} as const;
export type AccentId = keyof typeof ACCENTS;

/**
 * Font pairs: heading + body family names as Typst sees them (all vendored, OFL, in
 * public/typst/fonts). "template" = the template's own choice.
 */
export const FONT_PAIRS = {
    template: { label: "Template default", heading: "", body: "" },
    inter: { label: "Inter", heading: "Inter", body: "Inter" },
    plex: { label: "IBM Plex Sans", heading: "IBM Plex Sans", body: "IBM Plex Sans" },
    editorial: { label: "Plex Serif + Sans", heading: "IBM Plex Serif", body: "IBM Plex Sans" },
    libertinus: { label: "Libertinus Serif", heading: "Libertinus Serif", body: "Libertinus Serif" },
} as const;
export type FontPairId = keyof typeof FONT_PAIRS;

export const PAPERS = { a4: "A4", "us-letter": "US Letter" } as const;
export type PaperId = keyof typeof PAPERS;

export interface ResumeTheme {
    templateId: TemplateId;
    accent: AccentId;
    font: FontPairId;
    paper: PaperId;
}

export const DEFAULT_THEME: ResumeTheme = { templateId: DEFAULT_TEMPLATE, accent: "template", font: "template", paper: "a4" };

const isKey = <T extends object>(obj: T, v: unknown): v is keyof T => typeof v === "string" && Object.prototype.hasOwnProperty.call(obj, v);

export function normalizeTheme(raw: unknown): ResumeTheme {
    const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    return {
        templateId: typeof r.templateId === "string" && isTemplateId(r.templateId) ? r.templateId : DEFAULT_THEME.templateId,
        accent: isKey(ACCENTS, r.accent) ? r.accent : DEFAULT_THEME.accent,
        font: isKey(FONT_PAIRS, r.font) ? r.font : DEFAULT_THEME.font,
        paper: isKey(PAPERS, r.paper) ? r.paper : DEFAULT_THEME.paper,
    };
}
