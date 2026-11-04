// src/lib/match/resume-body.ts
// Shape check + bounding for a ResumeData sent over the wire to the Job Match routes. The body is
// the user's own library as the browser holds it; it is never written back, but it is sent to the
// model, so its size is capped the same way a save is.

import { RESUME_LIST_KEYS, type ResumeData } from "@/types/schema";
import { clampResumeData } from "@/lib/validation/limits";

/** Sections added later; a body from an older client (open tab, extension, guest draft) may lack them. */
const LATER_KEYS = new Set<string>(["custom"]);

export function isResumeData(v: unknown): v is ResumeData {
    if (!v || typeof v !== "object") return false;
    const o = v as Record<string, unknown>;
    return typeof o.personalInfo === "object" && o.personalInfo !== null && RESUME_LIST_KEYS.every(k => Array.isArray(o[k]) || (LATER_KEYS.has(k) && o[k] === undefined));
}

/** Missing later sections filled with []. */
export function withAllSections<T extends object>(v: T): T {
    const o = { ...v } as Record<string, unknown>;
    for (const k of RESUME_LIST_KEYS) if (!Array.isArray(o[k])) o[k] = [];
    return o as T;
}

/** A request body's `resume`, bounded; null when it does not look like a library. */
export function readResumeBody(v: unknown): ResumeData | null {
    return isResumeData(v) ? clampResumeData(withAllSections(v)) : null;
}
