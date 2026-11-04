// src/lib/sub-items.ts
// Per-bullet / per-skill selection. Pure and isomorphic.
//
// An item's `hidden` array holds the keys of the bullets (experience, projects,
// volunteering) or skills (skill categories) that are switched off. Keys are
// derived from the text, so reordering is safe and rewording a hidden line
// makes it a new, visible line. `pruneHidden` drops keys whose text is gone.
// `hidden` is not part of the content hash: toggling never stales tags.

/** List sections whose items carry `hidden`. */
export const SUB_ITEM_SECTIONS = ["workExperience", "projects", "volunteering", "custom", "skills"] as const;
export type SubItemSection = (typeof SUB_ITEM_SECTIONS)[number];

export interface SubItem {
    key: string;
    label: string;
}

const squash = (s: string) => s.trim().replace(/\s+/g, " ");

export const bulletKey = (bullet: string): string => squash(bullet);
export const skillKey = (skill: string): string => squash(skill).toLowerCase();

/** "Python, Go ,  Rust," -> ["Python", "Go", "Rust"] */
export function splitSkills(items: string | null | undefined): string[] {
    return (items ?? "").split(",").map(squash).filter(Boolean);
}

/**
 * Printed bullet lines from the editor's newline string or a stored array: split on newlines,
 * trimmed, leading "- " / "• " / "* " dropped, empty lines removed. Keys always come from these lines,
 * so the Library, the Editor, variants and the PDF agree on them.
 */
export function bulletLines(text: string | readonly string[] | null | undefined): string[] {
    const raw = Array.isArray(text) ? (text as readonly string[]).join("\n") : ((text as string | null | undefined) ?? "");
    return raw.split("\n").map(line => line.trim().replace(/^[-•*]\s+/, "")).filter(line => line !== "");
}

export const bulletEntries = (bullets: string[]): SubItem[] => bullets.map(b => ({ key: bulletKey(b), label: b }));
export const skillEntries = (items: string | null | undefined): SubItem[] => splitSkills(items).map(s => ({ key: skillKey(s), label: s }));

/** Entries not switched off. */
export function visible(entries: SubItem[], hidden: readonly string[] | null | undefined): SubItem[] {
    if (!hidden || hidden.length === 0) return entries;
    const off = new Set(hidden);
    return entries.filter(e => !off.has(e.key));
}

export function toggleHidden(hidden: readonly string[] | null | undefined, key: string): string[] {
    const list = hidden ?? [];
    return list.includes(key) ? list.filter(k => k !== key) : [...list, key];
}

/** Keeps only keys that still match an entry (deduped). */
export function pruneHidden(hidden: readonly string[] | null | undefined, entries: SubItem[]): string[] {
    if (!hidden || hidden.length === 0) return [];
    const present = new Set(entries.map(e => e.key));
    return [...new Set(hidden)].filter(k => present.has(k));
}

/** Hidden keys that still apply. */
export const hiddenCount = (entries: SubItem[], hidden: readonly string[] | null | undefined): number =>
    entries.length - visible(entries, hidden).length;
