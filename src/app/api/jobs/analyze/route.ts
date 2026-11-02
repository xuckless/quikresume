// src/app/api/jobs/analyze/route.ts
// POST multipart: `text` (pasted job description) OR the upload contract from
// /api/import (`file` / `pages` / `fileName`). Images are transcribed with
// GLM-4.6V, then the text model extracts structured requirements. When the
// form also carries `resume` (ResumeData as JSON), the job is saved as
// `match.status: "running"` and returned right away; the reconcile pass
// (lib/match/reconcile.ts, max effort) runs after the response and writes its verdicts.
//
// Guarded (lib/security/guard.ts): same-origin, session, per-user rate limit, daily AI budget.
// The posting is fenced as untrusted data before it reaches the model.

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { GlmError, glmErrorStatus } from "@/lib/glm/client";
import { formToDocument, isDocumentError, transcribeImages } from "@/lib/import/document-text";
import { ImportParseError } from "@/lib/import/parsed-resume";
import { analyzeAndSaveJob, AnalyzeJobError } from "@/lib/match/analyze-job";
import { readResumeBody } from "@/lib/match/resume-body";
import { JD_MAX_CHARS } from "@/lib/match/prompt";
import { guardApi } from "@/lib/security/guard";
import { RATE } from "@/lib/security/rate-limit";
import { withAiUser } from "@/lib/security/ai-budget";
import { sanitizeForPrompt } from "@/lib/security/prompt";
import { MAX_JSON_BYTES } from "@/lib/security/request";

export const runtime = "nodejs";
// The reconcile pass runs after the response (after()) at max reasoning effort, inside this limit.
export const maxDuration = 300;

const fail = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: Request) {
    const startedAt = Date.now();
    const g = await guardApi(req, RATE.jobAnalyze, { ai: true, feature: "Job Match", what: "job analyses" });
    if (!g.ok) return g.response;
    const uid = g.uid;

    let form: FormData;
    try {
        form = await req.formData();
    } catch {
        return fail(400, "Expected a multipart form.");
    }

    const resumeRaw = form.get("resume");
    if (typeof resumeRaw === "string" && resumeRaw.length > MAX_JSON_BYTES) return fail(413, "That request is too large.");
    const resume = typeof resumeRaw === "string" && resumeRaw ? readResumeBody(safeParse(resumeRaw)) : null;

    let jdText = sanitizeForPrompt(String(form.get("text") ?? ""), JD_MAX_CHARS);
    let source: { kind: "paste" | "file"; fileName: string | null } = { kind: "paste", fileName: null };

    return withAiUser(uid, "job-analyze", async () => {
        try {
            if (!jdText) {
                const doc = await formToDocument(form, "job-posting");
                if (isDocumentError(doc)) return fail(doc.status, doc.error);
                source = { kind: "file", fileName: doc.fileName };
                jdText = sanitizeForPrompt(doc.kind === "text" ? (doc.text ?? "") : await transcribeImages(doc.parts, "job posting"), JD_MAX_CHARS);
            }
            const job = await analyzeAndSaveJob(uid, { jdText, source, resume, startedAt });
            revalidatePath("/dashboard");
            return NextResponse.json({ ok: true, job });
        } catch (err) {
            if (err instanceof AnalyzeJobError) return fail(err.status, err.message);
            if (err instanceof ImportParseError) {
                console.error("[jobs/analyze] unparseable reply:", err.raw.slice(0, 500));
                return fail(502, "The AI reply could not be understood. Please try again.");
            }
            if (err instanceof GlmError) {
                console.error("[jobs/analyze] GLM error:", err.message);
                return fail(glmErrorStatus(err), err.message);
            }
            console.error("[jobs/analyze]", err);
            return fail(500, "Something went wrong while analysing the job.");
        }
    });
}

function safeParse(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}
