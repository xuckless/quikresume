// src/lib/resume-mapper.ts
// Pure mapping from the serialized Firestore rows (src/types/db.ts) to the
// editor model (src/types/schema.ts). Called on the server by the dashboard
// page so the client receives a complete ResumeData, personal info included.

import { PRESENT, toDateInputValue } from "@/lib/dates";
import type {
    AwardItem,
    CertificationItem,
    CustomItem,
    EducationItem,
    ExperienceItem,
    LanguageItem,
    ProjectItem,
    PublicationItem,
    SkillCategoryItem,
    UserProfile,
    VolunteeringItem,
} from "@/types/db";
import type { PersonalInfo, ResumeData } from "@/types/schema";
import { normalizeLayout } from "@/lib/layout/presets";

export interface ResumeSources {
    profile: UserProfile | null;
    /** Display name from the auth session, used when the profile has no name yet. */
    fallbackName?: string | null;
    experiences: ExperienceItem[];
    educations: EducationItem[];
    skills: SkillCategoryItem[];
    projects: ProjectItem[];
    certifications: CertificationItem[];
    awards: AwardItem[];
    volunteering: VolunteeringItem[];
    publications: PublicationItem[];
    languages: LanguageItem[];
    /** Absent in callers that predate custom sections. */
    custom?: CustomItem[];
    /** Raw users/{uid}/meta/layout document (normalised here). */
    layout?: unknown;
}

const s = (v: string | null | undefined): string => v ?? "";

export function splitName(profile: UserProfile | null, fallbackName?: string | null): { firstName: string; lastName: string } {
    if (profile?.firstName || profile?.lastName) {
        return { firstName: s(profile.firstName), lastName: s(profile.lastName) };
    }
    const parts = (fallbackName ?? "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return { firstName: "", lastName: "" };
    return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

const endDateOf = (isActive: boolean, endDate: string | null) =>
    isActive ? PRESENT : toDateInputValue(endDate);

export function toResumeData(src: ResumeSources): ResumeData {
    const p = src.profile;
    return {
        personalInfo: {
            ...splitName(p, src.fallbackName),
            headline: s(p?.headline),
            email: s(p?.professionalEmail || p?.email),
            phone: s(p?.phoneNumber),
            location: s(p?.location),
            github: s(p?.github),
            linkedin: s(p?.linkedIn),
            website: s(p?.website),
            summary: s(p?.bio),
        },
        profileTags: p?.profileTags ?? [],
        profileTagsHash: p?.profileTagsHash ?? null,
        links: p?.links ?? [],
        workExperience: src.experiences.map(e => ({
            id: e.id,
            title: e.position,
            company: e.company,
            startDate: toDateInputValue(e.startDate),
            endDate: endDateOf(e.isActive, e.endDate),
            description: e.description.join("\n"),
            hidden: e.hidden,
            isSelected: e.isSelected,
            tags: e.tags,
            tagsHash: e.tagsHash,
        })),
        education: src.educations.map(e => ({
            id: e.id,
            degree: e.programName,
            institution: e.schoolName,
            startDate: toDateInputValue(e.startDate),
            endDate: endDateOf(e.isActive, e.endDate),
            gpa: s(e.gpa),
            minor: s(e.minorName),
            details: s(e.details),
            isSelected: e.isSelected,
            tags: e.tags,
            tagsHash: e.tagsHash,
        })),
        skills: src.skills.map(k => ({
            id: k.id,
            category: k.category,
            items: k.items,
            hidden: k.hidden,
            isSelected: k.isSelected,
            tags: k.tags,
            tagsHash: k.tagsHash,
        })),
        projects: src.projects.map(pr => ({
            id: pr.id,
            title: pr.title,
            stack: s(pr.stack),
            link: s(pr.link),
            startDate: toDateInputValue(pr.startDate),
            endDate: endDateOf(pr.isActive, pr.endDate),
            description: pr.description.join("\n"),
            hidden: pr.hidden,
            isSelected: pr.isSelected,
            tags: pr.tags,
            tagsHash: pr.tagsHash,
        })),
        certifications: src.certifications.map(c => ({
            id: c.id,
            name: c.name,
            issuer: s(c.issuer),
            year: c.year,
            credentialId: s(c.credentialId),
            expires: s(c.expires),
            isSelected: c.isSelected,
            tags: c.tags,
            tagsHash: c.tagsHash,
        })),
        awards: src.awards.map(a => ({
            id: a.id,
            title: a.title,
            issuer: s(a.issuer),
            date: toDateInputValue(a.date),
            description: s(a.description),
            isSelected: a.isSelected,
            tags: a.tags,
            tagsHash: a.tagsHash,
        })),
        volunteering: src.volunteering.map(v => ({
            id: v.id,
            role: v.role,
            organization: v.organization,
            startDate: toDateInputValue(v.startDate),
            endDate: endDateOf(v.isActive, v.endDate),
            description: v.description.join("\n"),
            hidden: v.hidden,
            isSelected: v.isSelected,
            tags: v.tags,
            tagsHash: v.tagsHash,
        })),
        publications: src.publications.map(pub => ({
            id: pub.id,
            title: pub.title,
            venue: s(pub.venue),
            date: toDateInputValue(pub.date),
            link: s(pub.link),
            authors: s(pub.authors),
            isSelected: pub.isSelected,
            tags: pub.tags,
            tagsHash: pub.tagsHash,
        })),
        languages: src.languages.map(l => ({
            id: l.id,
            language: l.language,
            proficiency: s(l.proficiency),
            isSelected: l.isSelected,
            tags: l.tags,
            tagsHash: l.tagsHash,
        })),
        custom: (src.custom ?? []).map(c => ({
            id: c.id,
            section: c.section,
            title: c.title,
            subtitle: s(c.subtitle),
            startDate: toDateInputValue(c.startDate),
            endDate: endDateOf(c.isActive, c.endDate),
            description: c.description.join("\n"),
            hidden: c.hidden,
            isSelected: c.isSelected,
            tags: c.tags,
            tagsHash: c.tagsHash,
        })),
        layout: normalizeLayout(src.layout),
    };
}

/** Optional strings are stored as null, never "". */
const orNull = (v: string | null | undefined): string | null => (v && v.trim() !== "" ? v.trim() : null);

/**
 * PersonalInfo -> fields of the users/{uid} document. Shared by saveResumeData
 * (Master Editor) and updateUserProfile (Profile page) so both write the same
 * shape. The caller adds `updatedAt`.
 */
export function personalInfoToUserDoc(p: PersonalInfo) {
    return {
        firstName: p.firstName.trim(),
        lastName: p.lastName.trim(),
        headline: orNull(p.headline),
        professionalEmail: orNull(p.email),
        phoneNumber: orNull(p.phone),
        location: orNull(p.location),
        github: orNull(p.github),
        linkedIn: orNull(p.linkedin),
        website: orNull(p.website),
        bio: orNull(p.summary),
    };
}

/** Editor-model personal info from the stored profile (+ session name fallback). */
export function toPersonalInfo(profile: UserProfile | null, fallbackName?: string | null): PersonalInfo {
    return toResumeData({
        profile, fallbackName,
        experiences: [], educations: [], skills: [], projects: [], certifications: [],
        awards: [], volunteering: [], publications: [], languages: [],
    }).personalInfo;
}
