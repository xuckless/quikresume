// src/lib/review/content.ts
// What the reviewer sees per item, and when a review is out of date. Pure and isomorphic.
//
// HASH RULE: a review is stale when `reviewHash` differs from the item's content hash, exactly the hash
// smart tags use (lib/tags/content.ts), so editing text re-reviews it and toggling / reordering never does.

import type { PersonalInfo, ResumeData, ResumeListKey } from "@/types/schema";
import { RESUME_LIST_KEYS } from "@/types/schema";
import { contentHashOf, hasContent, PROFILE_ID, profileHashOf, profileText } from "@/lib/tags/content";
import { itemLabel, itemShortTitle, itemTitle } from "@/lib/sections";
import { toBullets } from "@/lib/typst/doc";
import type { ReviewHistoryEntry } from "./history";
import { LOW_SCORE, type ItemReview, type ReviewFlag, type ReviewTarget } from "./types";

type AnyItem = ResumeData[ResumeListKey][number];

export interface ReviewFieldSpec {
    /** Editor-model key on the item (or PersonalInfo for the profile). */
    field: string;
    /** FormData key the section's update action reads. */
    form: string;
    label: string;
    bullets?: true;
}

export const REVIEW_FIELDS: Record<ReviewTarget, ReviewFieldSpec[]> = {
    workExperience: [
        { field: "title", form: "position", label: "Position" },
        { field: "company", form: "company", label: "Company" },
        { field: "description", form: "description", label: "Bullets", bullets: true },
    ],
    education: [
        { field: "degree", form: "programName", label: "Degree" },
        { field: "institution", form: "schoolName", label: "Institution" },
        { field: "details", form: "details", label: "Honors / coursework" },
    ],
    skills: [
        { field: "category", form: "category", label: "Category" },
        { field: "items", form: "items", label: "Skills" },
    ],
    projects: [
        { field: "title", form: "title", label: "Title" },
        { field: "stack", form: "stack", label: "Tech stack" },
        { field: "description", form: "description", label: "Bullets", bullets: true },
    ],
    certifications: [
        { field: "name", form: "name", label: "Name" },
        { field: "issuer", form: "issuer", label: "Issuer" },
    ],
    awards: [
        { field: "title", form: "title", label: "Title" },
        { field: "issuer", form: "issuer", label: "Issuer" },
        { field: "description", form: "description", label: "Description" },
    ],
    volunteering: [
        { field: "role", form: "role", label: "Role" },
        { field: "organization", form: "organization", label: "Organization" },
        { field: "description", form: "description", label: "Bullets", bullets: true },
    ],
    custom: [
        { field: "title", form: "title", label: "Title" },
        { field: "subtitle", form: "subtitle", label: "Detail" },
        { field: "description", form: "description", label: "Bullets", bullets: true },
    ],
    publications: [
        { field: "title", form: "title", label: "Title" },
        { field: "venue", form: "venue", label: "Venue" },
        { field: "authors", form: "authors", label: "Authors" },
    ],
    languages: [
        { field: "language", form: "language", label: "Language" },
        { field: "proficiency", form: "proficiency", label: "Proficiency" },
    ],
    profile: [
        { field: "headline", form: "headline", label: "Headline" },
        { field: "summary", form: "summary", label: "Summary" },
    ],
};

export const fieldSpec = (target: ReviewTarget, field: string) => REVIEW_FIELDS[target].find(f => f.field === field);

/** One unit of work for the reviewer. */
export interface ReviewInput {
    id: string;
    target: ReviewTarget;
    label: string;
    /** Dates or year, for context only. */
    meta: string;
    fields: Record<string, string | string[]>;
    /** Earlier accepted / declined rewrites (server-side, filled in by the run route). */
    history?: ReviewHistoryEntry[];
}

const value = (source: object, field: string) => {
    const v = (source as Record<string, unknown>)[field];
    return typeof v === "string" ? v.trim() : "";
};

function fieldsOf(target: ReviewTarget, source: object): Record<string, string | string[]> {
    const out: Record<string, string | string[]> = {};
    for (const spec of REVIEW_FIELDS[target]) {
        const v = value(source, spec.field);
        if (!v) continue;
        out[spec.field] = spec.bullets ? toBullets(v) : v;
    }
    return out;
}

export function reviewInputOf<K extends ResumeListKey>(key: K, item: ResumeData[K][number]): ReviewInput {
    return { id: item.id, target: key, label: itemTitle(key, item), meta: itemLabel(key, item).meta, fields: fieldsOf(key, item) };
}

export function profileReviewInput(p: PersonalInfo): ReviewInput {
    return { id: PROFILE_ID, target: "profile", label: "Headline & summary", meta: "", fields: fieldsOf("profile", p) };
}

export function isReviewStale<K extends ResumeListKey>(key: K, item: ResumeData[K][number], review: ItemReview | null | undefined): boolean {
    return hasContent(key, item) && review?.reviewHash !== contentHashOf(key, item);
}

export function isProfileReviewStale(p: PersonalInfo, review: ItemReview | null | undefined): boolean {
    return profileText(p) !== "" && review?.reviewHash !== profileHashOf(p);
}

/** The review was written against another version of the "About you" brief. */
export function isBriefOutdated(review: ItemReview | null | undefined, briefHash: string | null): boolean {
    return Boolean(review && briefHash && review.briefHash !== briefHash);
}

export type ReviewMap = Record<string, ItemReview | null>;

/** Items (and the profile) with no review for their current text. */
export function reviewStaleInputs(data: ResumeData, reviews: ReviewMap, profileReview: ItemReview | null): ReviewInput[] {
    const out: ReviewInput[] = [];
    if (isProfileReviewStale(data.personalInfo, profileReview)) out.push(profileReviewInput(data.personalInfo));
    for (const key of RESUME_LIST_KEYS) {
        for (const item of data[key] as AnyItem[]) {
            if (isReviewStale(key, item, reviews[item.id])) out.push(reviewInputOf(key, item));
        }
    }
    return out;
}

/**
 * Signature of what is stale: ids AND the text hash, so a second change to the same item is a new set of
 * changes (an automatic run keyed on ids alone would never review it again this session).
 */
export function staleReviewSignature(data: ResumeData, reviews: ReviewMap, profileReview: ItemReview | null): string {
    const out: string[] = [];
    if (isProfileReviewStale(data.personalInfo, profileReview)) out.push(`${PROFILE_ID}:${profileHashOf(data.personalInfo)}`);
    for (const key of RESUME_LIST_KEYS) {
        for (const item of data[key] as AnyItem[]) {
            if (isReviewStale(key, item, reviews[item.id])) out.push(`${item.id}:${contentHashOf(key, item)}`);
        }
    }
    return out.sort().join(",");
}

export interface LowScoreItem {
    section: ResumeListKey | "summary";
    id: string;
    label: string;
    score: number;
    flags: ReviewFlag[];
}

/** Up-to-date reviews at or below LOW_SCORE, lowest first (the Action items row). */
export function lowScoreItems(data: ResumeData, reviews: ReviewMap, profileReview: ItemReview | null): LowScoreItem[] {
    const out: LowScoreItem[] = [];
    if (profileReview && !isProfileReviewStale(data.personalInfo, profileReview) && profileReview.score <= LOW_SCORE) {
        out.push({ section: "summary", id: "summary", label: "Headline & summary", score: profileReview.score, flags: profileReview.flags });
    }
    for (const key of RESUME_LIST_KEYS) {
        for (const item of data[key] as AnyItem[]) {
            const r = reviews[item.id];
            if (r && !isReviewStale(key, item, r) && r.score <= LOW_SCORE) out.push({ section: key, id: item.id, label: itemShortTitle(key, item), score: r.score, flags: r.flags });
        }
    }
    return out.sort((a, b) => a.score - b.score);
}
