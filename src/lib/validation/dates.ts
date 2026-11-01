// src/lib/validation/dates.ts
// Pure date checks shared by the editor (inline errors, Save & Exit gate) and
// saveResumeData (server re-check). Dates are month precision ("YYYY-MM-01").
//
// Rules: dates are optional; an end without a start is an error; end before
// start is an error (the same month is fine); a start or single date may not
// be after the current month; a future end date is allowed ("Present" never
// needs checking). Certifications' free-text year must be a plain year, not
// in the future.

import type { ResumeData, ResumeListKey } from "@/types/schema";
import { RESUME_LIST_KEYS } from "@/types/schema";
import { currentMonthKey, monthKey, parseYear, PRESENT } from "@/lib/dates";
import { itemShortTitle } from "@/lib/sections";

export interface DateErrors {
    start?: string;
    end?: string;
    /** Single date (awards, publications) or certification year. */
    date?: string;
    /** Certification / licence expiry ("YYYY" or "YYYY-MM"; past dates are allowed, an expired licence is still a fact). */
    expires?: string;
}

type AnyItem = ResumeData[ResumeListKey][number];

const RANGE_SECTIONS: ReadonlySet<ResumeListKey> = new Set(["workExperience", "education", "projects", "volunteering"]);

export function validateItemDates(key: ResumeListKey, item: AnyItem, now: Date = new Date()): DateErrors {
    const x = item as unknown as Record<string, string>;
    const nowKey = currentMonthKey(now);
    const errors: DateErrors = {};

    if (RANGE_SECTIONS.has(key)) {
        const start = monthKey(x.startDate);
        const endRaw = x.endDate ?? "";
        const end = endRaw === PRESENT ? null : monthKey(endRaw);
        if (x.startDate && start === null) errors.start = "Not a valid date.";
        else if (start !== null && start > nowKey) errors.start = "Start date can't be in the future.";
        if (endRaw && endRaw !== PRESENT && end === null) errors.end = "Not a valid date.";
        else if (end !== null && start === null && !errors.start) errors.end = "Add a start date, or clear the end date.";
        else if (end !== null && start !== null && end < start) errors.end = "End date can't be before the start date.";
        return errors;
    }
    if (key === "awards" || key === "publications") {
        const d = monthKey(x.date);
        if (x.date && d === null) errors.date = "Not a valid date.";
        else if (d !== null && d > nowKey) errors.date = "Date can't be in the future.";
        return errors;
    }
    if (key === "certifications" && x.year?.trim()) {
        const y = parseYear(x.year);
        if (y === null) errors.date = "Use a 4-digit year, e.g. 2024.";
        else if (y > now.getFullYear()) errors.date = "Year can't be in the future.";
    }
    if (key === "certifications" && x.expires?.trim()) {
        const m = /^(\d{4})(?:-(\d{2}))?$/.exec(x.expires.trim());
        if (!m || (m[2] !== undefined && (Number(m[2]) < 1 || Number(m[2]) > 12))) errors.expires = "Use YYYY or YYYY-MM, e.g. 2027-05.";
    }
    return errors;
}

export const hasDateErrors = (e: DateErrors) => Boolean(e.start || e.end || e.date || e.expires);

export interface InvalidDateItem {
    section: ResumeListKey;
    id: string;
    label: string;
    message: string;
}

export function invalidDateItems(data: ResumeData, now: Date = new Date()): InvalidDateItem[] {
    const out: InvalidDateItem[] = [];
    for (const key of RESUME_LIST_KEYS) {
        for (const item of data[key] as AnyItem[]) {
            const e = validateItemDates(key, item, now);
            const message = e.start ?? e.end ?? e.date ?? e.expires;
            if (message) out.push({ section: key, id: item.id, label: itemShortTitle(key, item), message });
        }
    }
    return out;
}
