// src/app/(dashboard)/dashboard/page.tsx
import { auth } from "@/auth"
import { getExperiences } from "@/app/actions/experience-actions"
import { getEducations } from "@/app/actions/education-actions"
import { getSkills } from "@/app/actions/skill-actions"
import { getProjects } from "@/app/actions/project-actions"
import { getCertifications } from "@/app/actions/certification-actions"
import { getAwards } from "@/app/actions/award-actions"
import { getVolunteering } from "@/app/actions/volunteering-actions"
import { getCustomEntries } from "@/app/actions/custom-actions"
import { getPublications } from "@/app/actions/publication-actions"
import { getLanguages } from "@/app/actions/language-actions"
import { getUserProfile } from "@/app/actions/user-actions"
import { getLayout } from "@/app/actions/layout-actions"
import { getLoadedVariantId, getVariants } from "@/app/actions/variant-actions"
import { variantUsage } from "@/lib/variants"
import { getJobs, getPreferences } from "@/app/actions/job-actions"
import { getTagAliases } from "@/app/actions/tag-actions"
import { getCharacterizationSummary } from "@/app/actions/about-actions"
import { DEFAULT_CAPS } from "@/lib/match/types"
import { toResumeData } from "@/lib/resume-mapper"
import DashboardClient from "@/components/dashboard-client"
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { PANE_COOKIE, parsePaneCookie } from "@/lib/ui/preview-pane-cookie";

// Save & Exit runs the smart-tag extractor (GLM) inside the server action;
// actions inherit this segment's limit.
export const maxDuration = 120;

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
    const session = await auth();

    if (!session?.user?.id) {
        redirect("/login");
    }

    const [cookieStore, sp, about, profile, experiences, educations, skills, projects, certifications, awards, volunteering, publications, languages, variants, loadedVariantId, jobs, preferences, tagAliases, layout, custom] =
        await Promise.all([
            cookies(),
            searchParams,
            getCharacterizationSummary(),
            getUserProfile(),
            getExperiences(),
            getEducations(),
            getSkills(),
            getProjects(),
            getCertifications(),
            getAwards(),
            getVolunteering(),
            getPublications(),
            getLanguages(),
            getVariants(),
            getLoadedVariantId(),
            getJobs(),
            getPreferences(),
            getTagAliases(),
            getLayout(),
            getCustomEntries(),
        ]);

    // First run: send new users to the "About you" questionnaire (skippable). Only from the Library landing
    // (no ?view), so a revalidation while the editor is open can never navigate away from a draft.
    if (about && about.status === null && !sp.view) redirect("/dashboard/about?first=1");

    // Build the complete editor model on the server so the preview has
    // personal info without the client having to fetch anything.
    const initialResumeData = toResumeData({
        profile,
        fallbackName: session.user.name,
        experiences,
        educations,
        skills,
        projects,
        certifications,
        awards,
        volunteering,
        publications,
        languages,
        custom,
        layout,
    });

    return (
        <DashboardClient
            initialResumeData={initialResumeData}
            experiences={experiences}
            educations={educations}
            skills={skills}
            projects={projects}
            certifications={certifications}
            awards={awards}
            volunteering={volunteering}
            publications={publications}
            languages={languages}
            custom={custom}
            variants={variants}
            variantUsage={variantUsage(variants)}
            loadedVariantId={loadedVariantId}
            jobs={jobs}
            preferences={preferences ?? { mutedProposals: [], caps: DEFAULT_CAPS, declinedSoftSkills: [] }}
            tagAliases={tagAliases}
            linkChecks={profile?.linkChecks ?? {}}
            about={about ?? { status: null, briefHash: null }}
            profileReview={profile?.profileReview ?? null}
            initialPane={parsePaneCookie(cookieStore.get(PANE_COOKIE)?.value)}
            userName={initialResumeData.personalInfo.firstName || session.user.name?.split(" ")[0] || "there"}
        />
    )
}
