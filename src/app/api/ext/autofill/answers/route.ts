// POST /api/ext/autofill/answers {jobId?, questions: [{id, label, options?, maxLength?}]}
// -> {answers: [{id, value, source: "saved" | "ai"}]}. Saved answers (Autofill preferences) are used
// word for word when the question matches; the rest are drafted by the text model (low effort) from
// the résumé the job uses, the candidate brief, the user's instructions and the posting.

import { chatCompletion, GlmError, glmErrorStatus, textModel } from "@/lib/glm/client";
import { extractJson, ImportParseError } from "@/lib/import/parsed-resume";
import { readAutofill } from "@/lib/db/autofill";
import { readJob } from "@/lib/db/jobs";
import { readCandidateContext } from "@/lib/db/characterization";
import { resumeForJob } from "@/lib/ext/match-summary";
import { toTypstDoc } from "@/lib/typst/doc";
import { renderedText } from "@/lib/match/text";
import { AUTOFILL_SYSTEM_PROMPT, autofillUserMessage, savedAnswerFor, type AnswerQuestion } from "@/lib/autofill/prompt";
import { extFail, extJson, extPreflight, guardExtension } from "@/lib/security/ext-guard";
import { RATE } from "@/lib/security/rate-limit";
import { withAiUser } from "@/lib/security/ai-budget";
import { cleanModelBlock, sanitizeForPrompt } from "@/lib/security/prompt";
import { readJsonBody } from "@/lib/security/request";
import { isDocId } from "@/lib/validation/limits";

export const runtime = "nodejs";
export const maxDuration = 120;
export const OPTIONS = extPreflight;

const MAX_QUESTIONS = 25;

function readQuestions(raw: unknown): AnswerQuestion[] {
    if (!Array.isArray(raw)) return [];
    const out: AnswerQuestion[] = [];
    for (const q of raw.slice(0, MAX_QUESTIONS)) {
        if (!q || typeof q !== "object") continue;
        const o = q as Record<string, unknown>;
        const id = typeof o.id === "string" ? o.id.slice(0, 64) : "";
        const label = typeof o.label === "string" ? sanitizeForPrompt(o.label, 500) : "";
        if (!id || !label) continue;
        const options = Array.isArray(o.options) ? o.options.filter((x): x is string => typeof x === "string").slice(0, 60).map(x => sanitizeForPrompt(x, 200)).filter(Boolean) : undefined;
        const maxLength = typeof o.maxLength === "number" && o.maxLength > 0 ? Math.min(10_000, Math.round(o.maxLength)) : undefined;
        out.push({ id, label, ...(options?.length ? { options } : {}), ...(maxLength ? { maxLength } : {}) });
    }
    return out;
}

export async function POST(req: Request) {
    const g = await guardExtension(req, RATE.autofill, { ai: true, feature: "Auto Fill", what: "Auto Fill runs" });
    if (!g.ok) return g.response;
    const body = await readJsonBody<{ jobId?: unknown; questions?: unknown }>(req, 128 * 1024);
    if (!body.ok) return body.response;
    const questions = readQuestions(body.body.questions);
    if (questions.length === 0) return extJson(req, { ok: true, answers: [] });
    const jobId = typeof body.body.jobId === "string" && isDocId(body.body.jobId) ? body.body.jobId : null;

    const uid = g.uid;
    const [job, prefs] = await Promise.all([jobId ? readJob(uid, jobId) : null, readAutofill(uid)]);
    const answers: { id: string; value: string; source: "saved" | "ai" }[] = [];
    const ask: AnswerQuestion[] = [];
    for (const q of questions) {
        const saved = savedAnswerFor(q.label, prefs.answers);
        if (saved !== null && (!q.options || q.options.includes(saved))) answers.push({ id: q.id, value: saved, source: "saved" });
        else ask.push(q);
    }
    if (ask.length === 0) return extJson(req, { ok: true, answers });

    return withAiUser(uid, "autofill", async () => {
        try {
            const [{ resume }, candidate] = await Promise.all([resumeForJob(uid, job?.variantId ?? null), readCandidateContext(uid)]);
            const result = await chatCompletion(
                [
                    { role: "system", content: AUTOFILL_SYSTEM_PROMPT },
                    {
                        role: "user",
                        content: autofillUserMessage({
                            resumeText: renderedText(toTypstDoc(resume)),
                            brief: candidate?.brief ?? null,
                            instructions: prefs.agentInstructions,
                            saved: prefs.answers.map(a => ({ question: a.question, answer: a.answer })),
                            jobText: job ? [job.title, job.company, job.jdText].filter(Boolean).join("\n") : "",
                            questions: ask,
                        }),
                    },
                ],
                { model: textModel(), json: true, effort: "low", temperature: 0.3, maxTokens: 6000 },
            );
            const json = extractJson(result.text) as { answers?: unknown };
            const byId = new Map(ask.map(q => [q.id, q]));
            for (const a of Array.isArray(json.answers) ? json.answers : []) {
                const o = (a ?? {}) as Record<string, unknown>;
                const q = typeof o.id === "string" ? byId.get(o.id) : undefined;
                if (!q || typeof o.value !== "string") continue;
                let value = cleanModelBlock(o.value, q.maxLength ?? 3000);
                if (q.options && value && !q.options.includes(value)) value = "";
                if (value) answers.push({ id: q.id, value, source: "ai" });
                byId.delete(q.id);
            }
            return extJson(req, { ok: true, answers });
        } catch (err) {
            if (err instanceof ImportParseError) return extFail(req, 502, "The AI reply could not be understood. Try again.");
            if (err instanceof GlmError) return extFail(req, glmErrorStatus(err), err.message);
            console.error("[ext/autofill/answers]", err);
            return extFail(req, 500, "Could not draft answers.");
        }
    });
}
