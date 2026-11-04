// src/lib/text/word-count.ts
// Pure word counting for the per-item size caution. The cap is a warning, never
// a block: an item past WORD_CAUTION words (all of its text, hidden bullets
// included) is flagged in the editor and listed under Action items.

import type { PersonalInfo, ResumeData, ResumeListKey } from "@/types/schema";
import { RESUME_LIST_KEYS } from "@/types/schema";
import { itemShortTitle } from "@/lib/sections";

export const WORD_CAUTION = 500;
/** The live counter under a field appears from here on. */
export const WORD_COUNTER_FROM = 400;

export function countWords(s: string | null | undefined): number {
    if (!s) return 0;
    const m = s.trim().match(/\S+/g);
    return m ? m.length : 0;
}

type AnyItem = ResumeData[ResumeListKey][number];

/** Every free-text field of an item, bullets included whether shown or hidden. */
export function itemWordCount(key: ResumeListKey, item: AnyItem): number {
    const x = item as unknown as Record<string, unknown>;
    const fields: Record<ResumeListKey, string[]> = {
        workExperience: ["title", "company", "description"],
        education: ["degree", "institution", "gpa", "minor", "details"],
        skills: ["category", "items"],
        projects: ["title", "stack", "description"],
        certifications: ["name", "issuer"],
        awards: ["title", "issuer", "description"],
        volunteering: ["role", "organization", "description"],
        custom: ["section", "title", "subtitle", "description"],
        publications: ["title", "venue", "authors"],
        languages: ["language", "proficiency"],
    };
    return fields[key].reduce((n, f) => n + countWords(typeof x[f] === "string" ? (x[f] as string) : ""), 0);
}

export function summaryWordCount(p: PersonalInfo): number {
    return countWords(p.summary);
}

export interface OverCapItem {
    section: ResumeListKey | "summary";
    id: string;
    label: string;
    words: number;
}

/** Items (and the summary) at or past the caution threshold. */
export function overCapItems(data: ResumeData): OverCapItem[] {
    const out: OverCapItem[] = [];
    const summary = summaryWordCount(data.personalInfo);
    if (summary >= WORD_CAUTION) out.push({ section: "summary", id: "summary", label: "Professional summary", words: summary });
    for (const key of RESUME_LIST_KEYS) {
        for (const item of data[key] as AnyItem[]) {
            const words = itemWordCount(key, item);
            if (words >= WORD_CAUTION) out.push({ section: key, id: item.id, label: itemShortTitle(key, item), words });
        }
    }
    return out;
}

/** Counter / caution text for a field or item body: nothing below WORD_COUNTER_FROM. */
export function wordCaution(words: number, scope = "this item"): { hint?: string; warning?: string } {
    if (words >= WORD_CAUTION) return { warning: `${words} / ${WORD_CAUTION} words in ${scope}. This is too long for a résumé, cut it down.` };
    if (words >= WORD_COUNTER_FROM) return { hint: `${words} / ${WORD_CAUTION} words in ${scope}` };
    return {};
}
