// POST /api/guest/match {jdText, resume, field, turnstile} -> {title, company, requirements, tagsById}
// Signed-out job match for /start: the posting -> requirements (low effort, no candidate brief) and the
// visitor's draft résumé -> skill tags, in parallel. No reconcile pass, no embeddings, nothing stored.
// The browser scores it with the same pure scoreJob the dashboard uses.

import { NextResponse } from "next/server";
import { chatCompletion, GlmError, glmErrorStatus, textModel } from "@/lib/glm/client";
import { extractJson, ImportParseError } from "@/lib/import/parsed-resume";
import { parseRequirements } from "@/lib/match/analyze-job";
import { JD_MAX_CHARS, JD_SYSTEM_PROMPT, jdUserMessage } from "@/lib/match/prompt";
import { readResumeBody } from "@/lib/match/resume-body";
import { extractTags } from "@/lib/tags/extract";
import { allInputs, tagContext } from "@/lib/tags/content";
import { GUEST_BUDGET, GUEST_POOL, guardGuest } from "@/lib/security/guest-guard";
import { RATE } from "@/lib/security/rate-limit";
import { withAiUser } from "@/lib/security/ai-budget";
import { cleanModelText, sanitizeForPrompt } from "@/lib/security/prompt";
import { readJsonBody } from "@/lib/security/request";

export const runtime = "nodejs";
export const maxDuration = 120;

const fail = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: Request) {
    const body = await readJsonBody<{ jdText?: unknown; resume?: unknown; field?: unknown; turnstile?: unknown }>(req, 512 * 1024);
    if (!body.ok) return body.response;
    const g = await guardGuest(req, RATE.guestMatch, typeof body.body.turnstile === "string" ? body.body.turnstile : "");
    if (!g.ok) return g.response;

    const jdText = sanitizeForPrompt(typeof body.body.jdText === "string" ? body.body.jdText : "", JD_MAX_CHARS);
    if (jdText.length < 40) return fail(400, "Paste the full job posting (it's too short to analyse).");
    const resume = readResumeBody(body.body.resume);
    if (!resume) return fail(400, "Import a résumé first.");
    const field = typeof body.body.field === "string" ? sanitizeForPrompt(body.body.field, 80) : "";
    const inputs = allInputs(resume).slice(0, 80);

    return withAiUser(g.guestId, "guest-match", async () => {
        try {
            const [jd, tags] = await Promise.all([
                chatCompletion(
                    [{ role: "system", content: JD_SYSTEM_PROMPT }, { role: "user", content: jdUserMessage(jdText) }],
                    { model: textModel(), json: true, effort: "low", temperature: 0.1, maxTokens: 6000 },
                ),
                inputs.length ? extractTags(inputs, {}, { budgetMs: 70_000, context: [field && `Field: ${field}`, tagContext(resume)].filter(Boolean).join("\n") }) : null,
            ]);
            const json = extractJson(jd.text) as Record<string, unknown>;
            const requirements = parseRequirements(json.requirements, {});
            if (requirements.length === 0) return fail(502, "No requirements could be read from that posting. Try pasting all of it.");
            return NextResponse.json({
                ok: true,
                title: cleanModelText(String(json.title ?? ""), 120) || "This job",
                company: cleanModelText(String(json.company ?? ""), 120),
                requirements,
                tagsById: tags?.tagsById ?? {},
            });
        } catch (err) {
            if (err instanceof ImportParseError) return fail(502, "The AI reply could not be understood. Try again.");
            if (err instanceof GlmError) return fail(glmErrorStatus(err), err.message);
            console.error("[guest/match]", err);
            return fail(500, "Something went wrong while matching.");
        }
    }, { budget: GUEST_BUDGET, pool: GUEST_POOL });
}
