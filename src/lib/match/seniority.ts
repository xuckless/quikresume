// src/lib/match/seniority.ts
// Seniority fit, pure. The JD analysis records the level a posting asks for (job.seniority); the
// candidate's level is read from the résumé being scored: years of selected, dated work (internships
// and co-ops don't count, overlaps merged) lifted by the most recent title (Senior / Lead / Manager /
// Director...). The fit multiplies the title sub-score (lib/match/score.ts). Under-qualified is
// penalised more than over-qualified: a senior applying to a mid role is usually still considered.

import type { ResumeData } from "@/types/schema";
import { orderedItems } from "@/lib/layout/order";
import { itemSpan } from "@/lib/match/units";

export const SENIORITY_LEVELS = ["intern", "entry", "mid", "senior", "lead", "executive"] as const;
export type Seniority = (typeof SENIORITY_LEVELS)[number];

export const SENIORITY_LABEL: Record<Seniority, string> = {
    intern: "Intern / student", entry: "Entry level", mid: "Mid level", senior: "Senior", lead: "Lead / manager", executive: "Director / executive",
};

export const isSeniority = (v: unknown): v is Seniority => typeof v === "string" && (SENIORITY_LEVELS as readonly string[]).includes(v);

const INTERN_RE = /\b(intern(ship)?|co-?op|student|trainee|apprentice)\b/i;
// Most specific first.
const TITLE_LEVEL: [RegExp, Seniority][] = [
    [/\b(chief|c[etofi]o|vice president|vp|svp|evp|director|head of|partner)\b/i, "executive"],
    [/\b(lead|principal|staff|manager|supervisor|foreman|charge nurse|superintendent|head)\b/i, "lead"],
    [/\b(senior|sr\.?|iii|journeyman|journeyperson|specialist ii)\b/i, "senior"],
    [/\b(junior|jr\.?|associate|graduate|entry level)\b|\b(i)$/i, "entry"],
];

const rank = (s: Seniority) => SENIORITY_LEVELS.indexOf(s);

export function titleLevel(title: string): Seniority | null {
    if (INTERN_RE.test(title)) return "intern";
    for (const [re, level] of TITLE_LEVEL) if (re.test(title)) return level;
    return null;
}

/** Years of selected, dated, non-internship work, overlaps merged. */
export function workYears(data: ResumeData, now: Date = new Date()): number {
    const spans = data.workExperience
        .filter(x => x.isSelected && !INTERN_RE.test(x.title))
        .map(x => itemSpan(data, "workExperience", x.id, now))
        .filter((s): s is [number, number] => s !== null)
        .sort((a, b) => a[0] - b[0]);
    let months = 0;
    let cur: [number, number] | null = null;
    for (const s of spans) {
        if (!cur || s[0] > cur[1] + 1) { if (cur) months += cur[1] - cur[0] + 1; cur = [s[0], s[1]]; }
        else cur[1] = Math.max(cur[1], s[1]);
    }
    if (cur) months += cur[1] - cur[0] + 1;
    return months / 12;
}

export interface CandidateLevel { level: Seniority; years: number; fromTitle: string | null }

export function candidateLevel(data: ResumeData, now: Date = new Date()): CandidateLevel {
    const years = Math.round(workYears(data, now) * 10) / 10;
    const byYears: Seniority = years < 0.5 ? "intern" : years < 2 ? "entry" : years < 5 ? "mid" : "senior";
    const latest = orderedItems("workExperience", data.workExperience.filter(x => x.isSelected), undefined)[0] ?? null;
    const byTitle = latest ? titleLevel(latest.title) : null;
    // A title lifts the level (a "Lead" with 3 years reads as lead) but never lowers what the years show;
    // an internship title only counts while there is no real work history.
    let level: Seniority = byYears;
    if (byTitle && byTitle !== "intern" && rank(byTitle) > rank(level)) level = byTitle;
    if (byTitle === "intern" && years < 0.5) level = "intern";
    return { level, years, fromTitle: byTitle && level === byTitle ? latest!.title : null };
}

/** 1 = same level. One step under 0.75, two 0.45, more 0.25; over-qualified one step 0.95, two 0.8, more 0.65. */
export function seniorityFit(job: Seniority, candidate: Seniority): number {
    const gap = rank(candidate) - rank(job);
    if (gap === 0) return 1;
    if (gap < 0) return gap === -1 ? 0.75 : gap === -2 ? 0.45 : 0.25;
    return gap === 1 ? 0.95 : gap === 2 ? 0.8 : 0.65;
}

const SENIORITY_NOTE_RE = /\b(senior|seniority|junior|mid[- ]?level|entry[- ]?level|over-?qualified|under-?qualified|stretch|\d+\+?\s*(years?|yrs?))\b/i;

/**
 * A fit note about seniority or years when the measured résumé level already meets the posting's level.
 * The match panel shows that measurement, so such a note (often built on older self-reported years)
 * would contradict it ("reads as senior (7.5 yrs)" next to "candidate is mid-level with 5 years").
 */
export function contradictsMeasuredLevel(note: string, jobLevel: Seniority | null, measured: Seniority | null): boolean {
    if (jobLevel === null || measured === null || rank(measured) < rank(jobLevel)) return false;
    return SENIORITY_NOTE_RE.test(note);
}
