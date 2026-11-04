// src/lib/layout/order.ts
// Pure ordering: items sort newest first (current, then latest end, then latest
// start; undated last) until the user drags a section's items, which stores a
// manual order. Items missing from a manual order (added later) slot in by date.
// Skills and languages have no dates: they keep load order until dragged.

import type { ResumeData, ResumeListKey } from "@/types/schema";
import { monthKey, parseYear, PRESENT } from "@/lib/dates";
import type { ResumeLayout, SectionId } from "./types";

type AnyItem = ResumeData[ResumeListKey][number];

const RANGE: ReadonlySet<ResumeListKey> = new Set(["workExperience", "education", "projects", "volunteering", "custom"]);
const UNDATED: ReadonlySet<ResumeListKey> = new Set(["skills", "languages"]);

export const isDatedSection = (key: ResumeListKey) => !UNDATED.has(key);

/** [current, primary, secondary]; bigger = newer. null primary = undated. */
function sortKey(key: ResumeListKey, item: AnyItem): [number, number | null, number] {
    const x = item as unknown as Record<string, string>;
    if (RANGE.has(key)) {
        const start = monthKey(x.startDate);
        if (x.endDate === PRESENT) return [1, start ?? Number.MAX_SAFE_INTEGER, start ?? 0];
        // A lone start date (e.g. a single-date project) counts as the end.
        return [0, monthKey(x.endDate) ?? start, start ?? 0];
    }
    if (key === "awards" || key === "publications") return [0, monthKey(x.date), 0];
    if (key === "certifications") { const y = parseYear(x.year); return [0, y === null ? null : y * 12 + 11, 0]; }
    return [0, null, 0];
}

/** Negative when `a` goes before `b` (a is newer). 0 for undated sections. */
export function compareByDate(key: ResumeListKey, a: AnyItem, b: AnyItem): number {
    if (UNDATED.has(key)) return 0;
    const [ca, pa, sa] = sortKey(key, a);
    const [cb, pb, sb] = sortKey(key, b);
    if (ca !== cb) return cb - ca;
    if (pa === null || pb === null) return pa === pb ? 0 : pa === null ? 1 : -1;
    if (pa !== pb) return pb - pa;
    return sb - sa;
}

export function sortByDate<T extends AnyItem>(key: ResumeListKey, items: readonly T[]): T[] {
    return [...items].sort((a, b) => compareByDate(key, a, b));
}

/** Display / print order of a section's items. */
export function orderedItems<T extends AnyItem>(key: ResumeListKey, items: readonly T[], layout: ResumeLayout | undefined): T[] {
    const manual = layout?.itemOrder[key];
    if (!manual) return sortByDate(key, items);
    const byId = new Map(items.map(it => [it.id, it]));
    const out: T[] = [];
    for (const id of manual) { const it = byId.get(id); if (it) { out.push(it); byId.delete(id); } }
    for (const it of sortByDate(key, [...byId.values()])) {
        if (UNDATED.has(key)) { out.push(it); continue; }
        // Right after the last item that is newer, so a hand-placed older item above doesn't pull it up.
        let after = -1;
        out.forEach((existing, i) => { if (compareByDate(key, existing, it) < 0) after = i; });
        out.splice(after + 1, 0, it);
    }
    return out;
}

export function hasManualOrder(layout: ResumeLayout, key: ResumeListKey): boolean {
    return Array.isArray(layout.itemOrder[key]);
}

function arrayMove<T>(arr: readonly T[], from: number, to: number): T[] {
    const next = [...arr];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
}

/** Moves `activeId` to `overId`'s position in the section order. */
export function moveSection(layout: ResumeLayout, activeId: SectionId, overId: SectionId): ResumeLayout {
    const from = layout.sectionOrder.indexOf(activeId);
    const to = layout.sectionOrder.indexOf(overId);
    if (from < 0 || to < 0 || from === to) return layout;
    return { ...layout, sectionOrder: arrayMove(layout.sectionOrder, from, to) };
}

/** Moves an item within the currently displayed order and stores that as the section's manual order. */
export function moveItem(layout: ResumeLayout, key: ResumeListKey, displayedIds: readonly string[], activeId: string, overId: string): ResumeLayout {
    const from = displayedIds.indexOf(activeId);
    const to = displayedIds.indexOf(overId);
    if (from < 0 || to < 0 || from === to) return layout;
    return { ...layout, itemOrder: { ...layout.itemOrder, [key]: arrayMove(displayedIds, from, to) } };
}

export function resetItemOrder(layout: ResumeLayout, key: ResumeListKey): ResumeLayout {
    const itemOrder = { ...layout.itemOrder };
    delete itemOrder[key];
    return { ...layout, itemOrder };
}
