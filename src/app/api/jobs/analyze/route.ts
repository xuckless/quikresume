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

import { after, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { chatCompletion, GlmError, glmErrorStatus, textModel } from "@/lib/glm/client";
import { formToDocument, isDocumentError, transcribeImages } from "@/lib/import/document-text";
import { extractJson, ImportParseError } from "@/lib/import/parsed-resume";
import { readTagAliases } from "@/lib/db/meta";
import { countJobs, createJob, MAX_JOBS } from "@/lib/db/jobs";
import { reconcileRunningMs, reconcileTimeoutMs, runReconcileJob } from "@/lib/match/reconcile";
import { readResumeBody } from "@/lib/match/resume-body";
import { JD_MAX_CHARS, JD_SYSTEM_PROMPT, jdUserMessage } from "@/lib/match/prompt";
import { makeTag, type AliasMap } from "@/lib/tags/normalize";
import { isTagKind } from "@/lib/tags/types";
import type { Requirement } from "@/lib/match/types";
import { readCandidateContext } from "@/lib/db/characterization";
import { guardApi } from "@/lib/security/guard";
import { RATE } from "@/lib/security/rate-limit";
import { withAiUser } from "@/lib/security/ai-budget";
import { cleanModelText, sanitizeForPrompt } from "@/lib/security/prompt";
import { MAX_JSON_BYTES } from "@/lib/security/request";

export const runtime = "nodejs";
// The reconcile pass runs after the response (after()) at max reasoning effort, inside this limit.
export const maxDuration = 300;

const fail = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });

function parseRequirements(raw: unknown, aliases: AliasMap): Requirement[] {
    if (!Array.isArray(raw)) return [];
    const out: Requirement[] = [];
    const seen = new Set<string>();
    for (const r of raw.slice(0, 60)) {
        if (!r || typeof r !== "object") continue;
        const o = r as Record<string, unknown>;
        if (typeof o.name !== "string" || !isTagKind(o.kind)) continue;
        const tag = makeTag(cleanModelText(o.name, 120), o.kind, aliases);
        if (!tag || seen.has(tag.name)) continue;
        seen.add(tag.name);
        out.push({
            ...tag,
            importance: o.importance === "nice" ? "nice" : "must",
            yearsMin: typeof o.yearsMin === "number" && o.yearsMin > 0 ? Math.min(40, Math.round(o.yearsMin)) : null,
            satisfiedBy: [], evidence: [], reason: "", semantic: [],
        });
    }
    return out;
}

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
            if ((await countJobs(uid)) >= MAX_JOBS) return fail(409, `You can keep at most ${MAX_JOBS} jobs. Delete some first.`);

            if (!jdText) {
                const doc = await formToDocument(form, "job-posting");
                if (isDocumentError(doc)) return fail(doc.status, doc.error);
                source = { kind: "file", fileName: doc.fileName };
                jdText = sanitizeForPrompt(doc.kind === "text" ? (doc.text ?? "") : await transcribeImages(doc.parts, "job posting"), JD_MAX_CHARS);
            }
            if (jdText.length < 40) return fail(400, "That job description is too short to analyse.");

            const candidate = await readCandidateContext(uid);
            const result = await chatCompletion(
                [{ role: "system", content: JD_SYSTEM_PROMPT }, { role: "user", content: jdUserMessage(jdText, candidate) }],
                { model: textModel(), json: true, effort: "low", temperature: 0.1, maxTokens: 6000 },
            );
            const json = extractJson(result.text) as Record<string, unknown>;
            const aliases = await readTagAliases(uid);
            const requirements = parseRequirements(json.requirements, aliases);
            if (requirements.length === 0) return fail(502, "No requirements could be extracted from that text. Try pasting the full posting.");

            const reconcileTimeout = reconcileTimeoutMs(startedAt);

            const job = await createJob(uid, {
                title: cleanModelText(String(json.title ?? ""), 120) || "Untitled job",
                company: cleanModelText(String(json.company ?? ""), 120),
                summary: cleanModelText(String(json.summary ?? ""), 600),
                source,
                jdText,
                requirements,
                fitNotes: candidate && Array.isArray(json.fitNotes)
                    ? json.fitNotes.filter((n): n is string => typeof n === "string" && n.trim() !== "").slice(0, 2).map(n => cleanModelText(n, 200))
                    : [],
            }, { runningForMs: resume ? reconcileRunningMs(reconcileTimeout) : undefined });
            // The job opens at once, scored on exact tags; the broader-context pass fills in behind it
            // (the client polls while job.match.status is "running"). The background run keeps the
            // user's AI budget context.
            if (resume) after(() => withAiUser(uid, "reconcile", () => runReconcileJob(uid, job, resume, aliases, candidate, reconcileTimeout)));
            revalidatePath("/dashboard");
            return NextResponse.json({ ok: true, job });
        } catch (err) {
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
