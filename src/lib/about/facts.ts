// src/lib/about/facts.ts
// Deterministic facts from the library (years of experience, education status, gaps) that prefill the
// questionnaire and ride along with the brief. Pure and isomorphic; dates parsed by parts (lib/dates.ts).

import type { ResumeData } from "@/types/schema";
import { currentMonthKey, monthKey, PRESENT } from "@/lib/dates";
import { stableHash } from "@/lib/hash";
import type { CandidateFacts, CareerStage, CharacterizationAnswers, EducationStatus, FollowUp } from "./types";

// Apprenticeships and trainee roles are paid work that trades and many employers count toward
// years of experience, so only internships, co-ops and student jobs are set apart.
const INTERN_RE = /\b(intern(ship)?|co-?op|student\s+(assistant|worker))\b/i;

type Interval = [number, number];

function intervals(data: ResumeData, now: Date, internships: boolean): Interval[] {
    const nowKey = currentMonthKey(now);
    const out: Interval[] = [];
    for (const x of data.workExperience) {
        if (INTERN_RE.test(x.title) !== internships) continue;
        const start = monthKey(x.startDate);
        if (start === null) continue;
        const end = x.endDate === PRESENT ? nowKey : monthKey(x.endDate) ?? start;
        out.push([start, Math.max(start, Math.min(end, nowKey))]);
    }
    return out;
}

/** Months covered by the intervals, overlaps counted once (a month range is inclusive). */
function mergedMonths(list: Interval[]): number {
    const sorted = [...list].sort((a, b) => a[0] - b[0]);
    let total = 0;
    let cur: Interval | null = null;
    for (const iv of sorted) {
        if (cur && iv[0] <= cur[1] + 1) cur[1] = Math.max(cur[1], iv[1]);
        else {
            if (cur) total += cur[1] - cur[0] + 1;
            cur = [iv[0], iv[1]];
        }
    }
    if (cur) total += cur[1] - cur[0] + 1;
    return total;
}

export function experienceMonths(data: ResumeData, now: Date = new Date()): { total: number; internship: number } {
    return { total: mergedMonths(intervals(data, now, false)), internship: mergedMonths(intervals(data, now, true)) };
}

/** Professional years (internships excluded), rounded to half years; null without dated experience. */
export function yearsOfExperience(data: ResumeData, now: Date = new Date()): number | null {
    const { total, internship } = experienceMonths(data, now);
    if (total === 0) return internship > 0 ? 0 : null;
    return Math.round((total / 12) * 2) / 2;
}

/** In school when an education entry is ongoing or ends in the future; otherwise graduated with the latest end. */
export function educationStatusOf(data: ResumeData, now: Date = new Date()): { status: EducationStatus; graduation: string } {
    if (data.education.length === 0) return { status: "", graduation: "" };
    const nowKey = currentMonthKey(now);
    let latest: { key: number; value: string } | null = null;
    let inSchool: { key: number; value: string } | null = null;
    for (const e of data.education) {
        if (e.endDate === PRESENT) { inSchool = inSchool ?? { key: Infinity, value: "" }; continue; }
        const k = monthKey(e.endDate);
        if (k === null) continue;
        if (k > nowKey) { if (!inSchool || k < inSchool.key) inSchool = { key: k, value: e.endDate }; }
        else if (!latest || k > latest.key) latest = { key: k, value: e.endDate };
    }
    if (inSchool) return { status: "in-school", graduation: inSchool.value };
    if (latest) return { status: "graduated", graduation: latest.value };
    return { status: "", graduation: "" };
}

const fromKey = (k: number) => `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}-01`;

/** Stretches of at least `minMonths` without work, counted from the first non-internship job (school years before it aren't gaps), newest first. */
export function employmentGaps(data: ResumeData, minMonths = 6, now: Date = new Date()): { from: string; to: string; months: number }[] {
    const jobs = intervals(data, now, false);
    if (jobs.length === 0) return [];
    const firstJob = Math.min(...jobs.map(j => j[0]));
    const list = [...jobs, ...intervals(data, now, true)].filter(iv => iv[1] >= firstJob).sort((a, b) => a[0] - b[0]);
    const gaps: { from: string; to: string; months: number }[] = [];
    let reach: number | null = null;
    for (const [start, end] of list) {
        if (reach !== null && start - reach - 1 >= minMonths) gaps.push({ from: fromKey(reach + 1), to: fromKey(start - 1), months: start - reach - 1 });
        reach = reach === null ? end : Math.max(reach, end);
    }
    const nowKey = currentMonthKey(now);
    if (reach !== null && nowKey - reach >= minMonths) gaps.push({ from: fromKey(reach + 1), to: fromKey(nowKey), months: nowKey - reach });
    return gaps.reverse();
}

export function careerStage(a: CharacterizationAnswers, now: Date = new Date()): CareerStage {
    const years = a.yearsExperience ?? 0;
    if (a.educationStatus === "in-school") return "student";
    const grad = monthKey(a.graduationDate);
    if (a.educationStatus === "graduated" && grad !== null && currentMonthKey(now) - grad <= 18 && years < 2) return "new-grad";
    if (years < 3) return "early";
    if (years < 8) return "mid";
    return "senior";
}

export function candidateFacts(a: CharacterizationAnswers, now: Date = new Date()): CandidateFacts {
    return {
        careerStage: careerStage(a, now),
        yearsExperience: a.yearsExperience,
        educationStatus: a.educationStatus,
        graduation: a.graduationDate || null,
    };
}

/** Everything the brief is written from. */
export function answersHash(a: CharacterizationAnswers, followUps: FollowUp[]): string {
    return stableHash(`about|${JSON.stringify(a)}|${JSON.stringify(followUps.map(f => [f.question, f.answer.trim()]))}`);
}

/** The inputs follow-up questions depend on: they regenerate only when this changes. */
export function coreHash(a: CharacterizationAnswers): string {
    return stableHash(`core|${JSON.stringify([a.field, a.yearsExperience, a.educationStatus, a.graduationDate, a.targetRoles, a.targetSeniority, a.careerChange, a.gaps.has])}`);
}
