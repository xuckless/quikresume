// src/app/actions/guest-actions.ts
"use server";

// After sign-in, the /start draft (kept only in the browser) becomes real data:
//   - an uploaded résumé is saved into the library, but only when the library is still empty (a returning
//     user's library is never merged with a guest import behind their back);
//   - the job they matched is saved to the Job Tracker with its requirements (no second analysis).

import { revalidatePath } from "next/cache";
import { requireUid } from "@/lib/db/session";
import { loadResumeData } from "@/lib/db/load-resume";
import { countJobs, createJob, MAX_JOBS, readRequirements } from "@/lib/db/jobs";
import { readResumeBody } from "@/lib/match/resume-body";
import { JD_MAX_CHARS } from "@/lib/match/prompt";
import { cleanModelText, sanitizeForPrompt } from "@/lib/security/prompt";
import { RATE, rateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { RESUME_LIST_KEYS } from "@/types/schema";
import { saveResumeData } from "./resume-actions";

export interface ClaimResult {
    ok: boolean;
    error?: string;
    resume: "saved" | "skipped-existing" | "none" | "failed";
    jobId: string | null;
}

export async function claimGuestDraft(input: { resume: unknown; source: unknown; job: unknown }): Promise<ClaimResult> {
    const uid = await requireUid();
    const limit = await rateLimit(RATE.save, uid);
    if (!limit.ok) return { ok: false, error: rateLimitMessage(limit, "saves"), resume: "none", jobId: null };

    let resumeState: ClaimResult["resume"] = "none";
    const resume = input.source === "upload" ? readResumeBody(input.resume) : null;
    if (resume) {
        const library = await loadResumeData(uid);
        const empty = RESUME_LIST_KEYS.every(k => (library[k] as unknown[]).length === 0);
        if (!empty) resumeState = "skipped-existing";
        else {
            // Keep the visitor's name / contacts only where the profile is still blank.
            const personalInfo = { ...resume.personalInfo };
            for (const [k, v] of Object.entries(library.personalInfo)) if (v) (personalInfo as Record<string, string>)[k] = v;
            const saved = await saveResumeData({ ...resume, personalInfo, layout: resume.layout ?? library.layout });
            resumeState = saved.success ? "saved" : "failed";
        }
    }

    let jobId: string | null = null;
    const j = input.job && typeof input.job === "object" ? (input.job as Record<string, unknown>) : null;
    if (j && (await countJobs(uid)) < MAX_JOBS) {
        const requirements = readRequirements(j.requirements).slice(0, 60);
        const jdText = sanitizeForPrompt(typeof j.jdText === "string" ? j.jdText : "", JD_MAX_CHARS);
        if (requirements.length > 0 && jdText.length >= 40) {
            const job = await createJob(uid, {
                title: cleanModelText(typeof j.title === "string" ? j.title : "", 120) || "Untitled job",
                company: cleanModelText(typeof j.company === "string" ? j.company : "", 120),
                summary: "",
                source: { kind: "paste", fileName: null },
                jdText,
                // Client-supplied: clamp every string, drop anything the analysis didn't produce.
                requirements: requirements.map(r => ({
                    ...r,
                    name: cleanModelText(r.name, 120).toLowerCase(),
                    display: cleanModelText(r.display, 120),
                    yearsMin: r.yearsMin !== null && r.yearsMin > 0 ? Math.min(40, Math.round(r.yearsMin)) : null,
                    satisfiedBy: [], evidence: [], reason: "", semantic: [],
                })).filter(r => r.name),
                fitNotes: [],
            });
            jobId = job.id;
        }
    }
    revalidatePath("/dashboard");
    return { ok: true, resume: resumeState, jobId };
}
