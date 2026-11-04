// src/lib/db/load-resume.ts
// Server-only: the complete editor model for a user, straight from Firestore
// (the same reads the dashboard page does, for routes/actions that need the
// whole library, e.g. tag backfill and variant snapshots).

import "server-only";
import { getExperiences } from "@/app/actions/experience-actions";
import { getEducations } from "@/app/actions/education-actions";
import { getSkills } from "@/app/actions/skill-actions";
import { getProjects } from "@/app/actions/project-actions";
import { getCertifications } from "@/app/actions/certification-actions";
import { getAwards } from "@/app/actions/award-actions";
import { getVolunteering } from "@/app/actions/volunteering-actions";
import { getCustomEntries } from "@/app/actions/custom-actions";
import { getPublications } from "@/app/actions/publication-actions";
import { getLanguages } from "@/app/actions/language-actions";
import { getUserProfile } from "@/app/actions/user-actions";
import { getLayout } from "@/app/actions/layout-actions";
import { toResumeData } from "@/lib/resume-mapper";
import type { ResumeData } from "@/types/schema";
import type { ReviewMap } from "@/lib/review/content";
import type { ItemReview } from "@/lib/review/types";

export interface LibraryWithReviews {
    data: ResumeData;
    /** Coach review per item id (null = not reviewed yet). */
    reviews: ReviewMap;
    profileReview: ItemReview | null;
}

/** The get* actions authenticate themselves; `uid` is accepted for symmetry with other helpers. */
export async function loadLibraryWithReviews(_uid: string, fallbackName?: string | null): Promise<LibraryWithReviews> {
    const [profile, experiences, educations, skills, projects, certifications, awards, volunteering, publications, languages, layout, custom] =
        await Promise.all([
            getUserProfile(), getExperiences(), getEducations(), getSkills(), getProjects(), getCertifications(),
            getAwards(), getVolunteering(), getPublications(), getLanguages(), getLayout(), getCustomEntries(),
        ]);
    const rows = [experiences, educations, skills, projects, certifications, awards, volunteering, publications, languages, custom].flat();
    return {
        data: toResumeData({ profile, fallbackName, experiences, educations, skills, projects, certifications, awards, volunteering, publications, languages, custom, layout }),
        reviews: Object.fromEntries(rows.map(r => [r.id, r.review])),
        profileReview: profile?.profileReview ?? null,
    };
}

export async function loadResumeData(uid: string, fallbackName?: string | null): Promise<ResumeData> {
    return (await loadLibraryWithReviews(uid, fallbackName)).data;
}
