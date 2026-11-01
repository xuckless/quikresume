// src/lib/import/merge.ts
// Pure merge of a reviewed import into the editor draft. New items are
// appended; an item whose normalised key already exists is *merged* into the
// existing one (bullets and skills unioned, empty scalar fields filled) so
// importing several resumes builds one richer library instead of duplicates.
// Personal info fills empty fields unless `replacePersonal` is set.

import type { PersonalInfo, ResumeData, ResumeListKey } from "@/types/schema";
import { RESUME_LIST_KEYS } from "@/types/schema";
import { toBullets } from "@/lib/typst/doc";
import { canon, findMatch } from "./match";

export interface ImportSelection {
    personalInfo: PersonalInfo | null;
    replacePersonal: boolean;
    items: Partial<{ [K in ResumeListKey]: ResumeData[K] }>;
}

export interface MergeResult {
    data: ResumeData;
    /** Items appended as new. */
    added: number;
    /** Existing items that gained bullets/skills/fields. */
    updated: number;
    /** Duplicates that brought nothing new. */
    unchanged: number;
    updatedIds: string[];
}

export type IncomingClass = "new" | "merge" | "same";

const norm = (v: string) => canon(v);

/** Union of newline-separated bullet lists (case-insensitive dedupe, existing order first). */
export function unionBullets(existing: string, incoming: string): string {
    const out = toBullets(existing);
    const seen = new Set(out.map(norm));
    for (const b of toBullets(incoming)) {
        const k = norm(b);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(b);
    }
    return out.join("\n");
}

/** Union of comma-separated skill lists. */
export function unionSkills(existing: string, incoming: string): string {
    const split = (s: string) => s.split(/[,;\n]/).map(x => x.trim()).filter(Boolean);
    const out = split(existing);
    const seen = new Set(out.map(norm));
    for (const s of split(incoming)) {
        const k = norm(s);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(s);
    }
    return out.join(", ");
}

const fill = (existing: string, incoming: string) => (existing.trim() ? existing : incoming.trim());

/**
 * Merges `incoming` into `existing` (same key). Returns the merged item and
 * whether anything actually changed. Never touches id / isSelected / tags.
 */
export function mergeItem<K extends ResumeListKey>(
    key: K,
    existing: ResumeData[K][number],
    incoming: ResumeData[K][number],
): { item: ResumeData[K][number]; changed: boolean } {
    const e = existing as unknown as Record<string, string>;
    const i = incoming as unknown as Record<string, string>;
    const next: Record<string, string> = { ...e };

    const fillFields = (fields: string[]) => {
        for (const f of fields) if (typeof i[f] === "string" && typeof e[f] === "string") next[f] = fill(e[f], i[f]);
    };
    switch (key) {
        case "workExperience": next.description = unionBullets(e.description, i.description); fillFields(["endDate"]); break;
        case "volunteering": next.description = unionBullets(e.description, i.description); fillFields(["endDate"]); break;
        case "projects": next.description = unionBullets(e.description, i.description); fillFields(["stack", "link", "startDate", "endDate"]); break;
        case "education": fillFields(["gpa", "minor", "details", "startDate", "endDate"]); break;
        case "skills": next.items = unionSkills(e.items, i.items); break;
        case "certifications": fillFields(["issuer", "year", "credentialId", "expires"]); break;
        case "awards": fillFields(["issuer", "date", "description"]); break;
        case "publications": fillFields(["venue", "date", "link", "authors"]); break;
        case "languages": fillFields(["proficiency"]); break;
    }
    const changed = Object.keys(next).some(k => next[k] !== e[k]);
    return { item: (changed ? next : e) as unknown as ResumeData[K][number], changed };
}

/** How an incoming item relates to what `base` already holds. */
export function classifyIncoming<K extends ResumeListKey>(
    base: ResumeData,
    key: K,
    item: ResumeData[K][number],
): { kind: IncomingClass; existing?: ResumeData[K][number] } {
    const list = base[key] as ResumeData[K][number][];
    const at = findMatch(key, list, item);
    if (at < 0) return { kind: "new" };
    const existing = list[at];
    return { kind: mergeItem(key, existing, item).changed ? "merge" : "same", existing };
}

export function mergeImport(base: ResumeData, sel: ImportSelection): MergeResult {
    let added = 0, updated = 0, unchanged = 0;
    const updatedIds: string[] = [];
    const data: ResumeData = { ...base };

    for (const key of RESUME_LIST_KEYS) {
        const incoming = sel.items[key];
        if (!incoming || incoming.length === 0) continue;
        const list = [...(base[key] as ResumeData[typeof key][number][])];
        for (const item of incoming as ResumeData[typeof key][number][]) {
            const at = findMatch(key, list, item);
            if (at < 0) {
                list.push(item);
                added++;
                continue;
            }
            const merged = mergeItem(key, list[at], item);
            if (merged.changed) {
                list[at] = merged.item;
                updated++;
                updatedIds.push(merged.item.id);
            } else {
                unchanged++;
            }
        }
        (data[key] as unknown[]) = list;
    }

    if (sel.personalInfo) {
        const merged = { ...base.personalInfo };
        for (const field of Object.keys(merged) as (keyof PersonalInfo)[]) {
            const incoming = sel.personalInfo[field]?.trim() ?? "";
            if (!incoming) continue;
            if (sel.replacePersonal || !merged[field].trim()) merged[field] = incoming;
        }
        data.personalInfo = merged;
    }

    return { data, added, updated, unchanged, updatedIds };
}

/** Parsed output of one file, as returned by /api/import. */
export interface ParsedFile {
    fileName: string;
    data: ResumeData;
    warnings: string[];
}

export interface CombinedImport {
    data: ResumeData;
    /** Item id -> file it first appeared in. */
    sourceById: Record<string, string>;
    warnings: { fileName: string; warnings: string[] }[];
    fileNames: string[];
}

/** Folds several parsed files into one candidate set (files dedupe and merge against each other). */
export function combineParsedFiles(files: ParsedFile[], empty: ResumeData): CombinedImport {
    let data = empty;
    const sourceById: Record<string, string> = {};
    for (const f of files) {
        const items: ImportSelection["items"] = {};
        for (const key of RESUME_LIST_KEYS) if (f.data[key].length) (items[key] as unknown[]) = f.data[key];
        const before = new Set(RESUME_LIST_KEYS.flatMap(key => (data[key] as { id: string }[]).map(it => it.id)));
        data = mergeImport(data, { personalInfo: f.data.personalInfo, replacePersonal: false, items }).data;
        for (const key of RESUME_LIST_KEYS) {
            for (const it of data[key] as { id: string }[]) if (!before.has(it.id)) sourceById[it.id] = f.fileName;
        }
    }
    return {
        data,
        sourceById,
        warnings: files.filter(f => f.warnings.length > 0).map(f => ({ fileName: f.fileName, warnings: f.warnings })),
        fileNames: files.map(f => f.fileName),
    };
}
