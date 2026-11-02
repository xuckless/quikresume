// GET /api/ext/autofill/profile?jobId= -> everything Auto Fill fills deterministically: contact
// details, latest role / school, years of experience, Autofill preferences, and which résumé the PDF
// will be (the job's linked variant, else the working selection).

import { readAutofill } from "@/lib/db/autofill";
import { readJob } from "@/lib/db/jobs";
import { readCharacterizationDoc } from "@/lib/db/characterization";
import { resumeForJob } from "@/lib/ext/match-summary";
import { orderedItems } from "@/lib/layout/order";
import { pdfFileName } from "@/lib/typst/doc";
import { extFail, extJson, extPreflight, guardExtension } from "@/lib/security/ext-guard";
import { RATE } from "@/lib/security/rate-limit";
import { isDocId } from "@/lib/validation/limits";

export const runtime = "nodejs";
export const OPTIONS = extPreflight;

export async function GET(req: Request) {
    const g = await guardExtension(req, RATE.extRead);
    if (!g.ok) return g.response;
    const jobId = new URL(req.url).searchParams.get("jobId");
    if (jobId && !isDocId(jobId)) return extFail(req, 400, "Bad job id.");
    const job = jobId ? await readJob(g.uid, jobId) : null;
    const [{ resume, source }, prefs, about] = await Promise.all([resumeForJob(g.uid, job?.variantId ?? null), readAutofill(g.uid), readCharacterizationDoc(g.uid)]);

    const p = resume.personalInfo;
    // Newest first by date (not the manual order): forms ask for the current role and latest school.
    const latestJob = orderedItems("workExperience", resume.workExperience.filter(i => i.isSelected), undefined)[0] ?? null;
    const latestEdu = orderedItems("education", resume.education.filter(i => i.isSelected), undefined)[0] ?? null;
    return extJson(req, {
        ok: true,
        profile: {
            firstName: p.firstName, lastName: p.lastName, email: p.email, phone: p.phone, location: p.location,
            linkedin: p.linkedin, github: p.github, website: p.website, headline: p.headline,
            currentTitle: latestJob?.title ?? "", currentCompany: latestJob?.endDate === "Present" ? latestJob.company : "",
            school: latestEdu?.institution ?? "", degree: latestEdu?.degree ?? "",
            graduation: latestEdu?.endDate && latestEdu.endDate !== "Present" ? latestEdu.endDate.slice(0, 7) : "",
            yearsExperience: about.facts?.yearsExperience ?? about.answers.yearsExperience ?? null,
        },
        prefs,
        resume: { ...source, fileName: pdfFileName(p) },
    });
}
