// /api/ext/jobs
//   GET  ?url=<posting url>  -> {ok, job: summary | null}: is this posting already saved?
//   POST {url, title, company, location, employmentType, description, extractionMethod}
//        -> {ok, existing, summary}. One-click import from the extension: the posting URL is
//        canonicalised (lib/jobs/canonical-url.ts); a known URL refreshes the posting fields only
//        (status, notes, applied date and linked variant are the user's and stay); a new one is
//        analysed like a pasted job and reconciled in the background against the whole library.

import { revalidatePath } from "next/cache";
import { canonicalJobUrl, jobUrlKey } from "@/lib/jobs/canonical-url";
import { findJobByUrlKey, patchJob, readJob } from "@/lib/db/jobs";
import { analyzeAndSaveJob, AnalyzeJobError } from "@/lib/match/analyze-job";
import { jobSummary, resumeForJob } from "@/lib/ext/match-summary";
import { JD_MAX_CHARS } from "@/lib/match/prompt";
import { GlmError, glmErrorStatus } from "@/lib/glm/client";
import { ImportParseError } from "@/lib/import/parsed-resume";
import { extFail, extJson, extPreflight, guardExtension } from "@/lib/security/ext-guard";
import { RATE } from "@/lib/security/rate-limit";
import { withAiUser } from "@/lib/security/ai-budget";
import { cleanModelText, sanitizeForPrompt } from "@/lib/security/prompt";
import { readJsonBody } from "@/lib/security/request";

export const runtime = "nodejs";
// The background reconcile pass runs inside this limit (after()).
export const maxDuration = 300;
export const OPTIONS = extPreflight;

export async function GET(req: Request) {
    const g = await guardExtension(req, RATE.extRead);
    if (!g.ok) return g.response;
    const raw = new URL(req.url).searchParams.get("url") ?? "";
    const canonical = canonicalJobUrl(raw);
    if (!canonical) return extJson(req, { ok: true, job: null });
    const job = await findJobByUrlKey(g.uid, jobUrlKey(canonical));
    return extJson(req, { ok: true, job: job ? await jobSummary(g.uid, (await readJob(g.uid, job.id)) ?? job) : null });
}

const str = (v: unknown, max: number) => (typeof v === "string" ? cleanModelText(v, max) : "");

export async function POST(req: Request) {
    const startedAt = Date.now();
    const g = await guardExtension(req, RATE.jobAnalyze, { ai: true, feature: "Job import", what: "job imports" });
    if (!g.ok) return g.response;
    const uid = g.uid;
    const body = await readJsonBody<Record<string, unknown>>(req, 256 * 1024);
    if (!body.ok) return body.response;
    const b = body.body;

    const canonical = canonicalJobUrl(typeof b.url === "string" ? b.url : "");
    if (!canonical) return extFail(req, 400, "This page has no usable web address.");
    const urlKey = jobUrlKey(canonical);
    const posting = { url: canonical, urlKey, location: str(b.location, 120), employmentType: str(b.employmentType, 60) };

    const existing = await findJobByUrlKey(uid, urlKey);
    if (existing) {
        const patch: Record<string, unknown> = { url: canonical };
        if (posting.location) patch.location = posting.location;
        if (posting.employmentType) patch.employmentType = posting.employmentType;
        await patchJob(uid, existing.id, patch);
        const job = await readJob(uid, existing.id);
        return extJson(req, { ok: true, existing: true, summary: job ? await jobSummary(uid, job) : null });
    }

    const title = str(b.title, 120);
    const company = str(b.company, 120);
    const description = sanitizeForPrompt(typeof b.description === "string" ? b.description : "", JD_MAX_CHARS);
    const jdText = sanitizeForPrompt([title && `Title: ${title}`, company && `Company: ${company}`, posting.location && `Location: ${posting.location}`, description].filter(Boolean).join("\n"), JD_MAX_CHARS);

    return withAiUser(uid, "job-analyze", async () => {
        try {
            // Reconcile is selection-independent: it judges requirements against the whole library.
            const { library } = await resumeForJob(uid, null);
            const job = await analyzeAndSaveJob(uid, {
                jdText,
                source: { kind: "extension", fileName: null },
                hints: { title, company },
                posting,
                resume: library,
                startedAt,
            });
            revalidatePath("/dashboard");
            return extJson(req, { ok: true, existing: false, summary: await jobSummary(uid, job) });
        } catch (err) {
            if (err instanceof AnalyzeJobError) return extFail(req, err.status, err.message);
            if (err instanceof ImportParseError) return extFail(req, 502, "The AI reply could not be understood. Please try again.");
            if (err instanceof GlmError) return extFail(req, glmErrorStatus(err), err.message);
            console.error("[ext/jobs]", err);
            return extFail(req, 500, "Something went wrong while saving the job.");
        }
    });
}
