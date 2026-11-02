// src/lib/match/units.ts
// The pieces of a résumé that semantic matching compares a requirement against. Pure.
//
// Each item yields one "head" unit (what the item is: "Work experience: Nurse at St. Mary's") and,
// for sections with bullets, one unit per bullet carrying its context ("Nurse at St. Mary's
// (2021–2024): Triaged 30+ patients a shift"). A bullet without context embeds poorly ("Led the
// migration" says nothing about which field), so the context is part of the embedded text.
// `bulletKey` ties a unit back to the per-bullet selection (lib/sub-items.ts) so a hidden bullet
// stops counting as evidence.

import type { ResumeData, ResumeListKey } from "@/types/schema";
import { RESUME_LIST_KEYS } from "@/types/schema";
import { bulletEntries, bulletLines } from "@/lib/sub-items";
import { contentHashOf, itemText } from "@/lib/tags/content";
import { itemLabel } from "@/lib/sections";
import { monthKey, currentMonthKey } from "@/lib/dates";

export interface MatchUnit {
    itemId: string;
    section: ResumeListKey;
    /** null = the item's head unit. */
    bulletKey: string | null;
    /** What gets embedded. */
    text: string;
    /** What the UI quotes (the bullet itself, or the item title). */
    quote: string;
}

export interface UnitItem {
    id: string;
    section: ResumeListKey;
    hash: string;
    units: MatchUnit[];
}

const BULLET_SECTIONS = new Set<ResumeListKey>(["workExperience", "projects", "volunteering"]);
const MAX_BULLETS_PER_ITEM = 12;

/** Every item of the library (selected or not) with its units and content hash. */
export function libraryUnits(data: ResumeData): UnitItem[] {
    const out: UnitItem[] = [];
    for (const section of RESUME_LIST_KEYS) {
        for (const item of data[section] as ResumeData[ResumeListKey][number][]) {
            const label = itemLabel(section, item);
            const head = itemText(section, item).split("\n")[0].slice(0, 400);
            const units: MatchUnit[] = [{ itemId: item.id, section, bulletKey: null, text: BULLET_SECTIONS.has(section) ? head : itemText(section, item).slice(0, 1200), quote: [label.title, label.subtitle].filter(Boolean).join(" · ") }];
            if (BULLET_SECTIONS.has(section) && "description" in item) {
                const ctx = [label.title, label.subtitle].filter(Boolean).join(" at ") + (label.meta ? ` (${label.meta})` : "");
                for (const b of bulletEntries(bulletLines(item.description)).slice(0, MAX_BULLETS_PER_ITEM)) {
                    units.push({ itemId: item.id, section, bulletKey: b.key, text: `${ctx}: ${b.label}`.slice(0, 600), quote: b.label });
                }
            }
            out.push({ id: item.id, section, hash: contentHashOf(section, item), units });
        }
    }
    return out;
}

/** Months between the item's end ("Present" / no end = now) and now; null when undated. */
export function itemAgeMonths(data: ResumeData, section: ResumeListKey, id: string, now: Date = new Date()): number | null {
    const item = (data[section] as unknown as Record<string, unknown>[]).find(x => x.id === id);
    if (!item) return null;
    const end = typeof item.endDate === "string" ? item.endDate : "";
    if (end === "Present") return 0;
    const key = monthKey(end) ?? monthKey(typeof item.date === "string" ? item.date : "") ?? monthKey(typeof item.startDate === "string" ? item.startDate : "");
    if (key === null) {
        const year = typeof item.year === "string" ? Number.parseInt(item.year, 10) : NaN;
        return Number.isFinite(year) ? Math.max(0, now.getFullYear() * 12 - year * 12) : null;
    }
    return Math.max(0, currentMonthKey(now) - key);
}

/** [startMonthKey, endMonthKey] of a dated item, for years-of-experience unions. */
export function itemSpan(data: ResumeData, section: ResumeListKey, id: string, now: Date = new Date()): [number, number] | null {
    const item = (data[section] as unknown as Record<string, unknown>[]).find(x => x.id === id);
    if (!item) return null;
    const start = monthKey(typeof item.startDate === "string" ? item.startDate : "");
    if (start === null) return null;
    const endRaw = typeof item.endDate === "string" ? item.endDate : "";
    const end = endRaw === "Present" || endRaw === "" ? currentMonthKey(now) : monthKey(endRaw) ?? currentMonthKey(now);
    return end >= start ? [start, end] : null;
}
