// src/app/api/jobs/proposals/route.ts
// POST { jobId, resume: ResumeData } -> { ok, proposals, score, requirements }.
// The requirements are first reconciled against the resume (lib/match/reconcile.ts)
// so the score and the set cover see semantic matches. Include/exclude proposals
// come from the deterministic set cover; rewrite / add-skill / gap proposals
// from the text model. Muted rules are filtered,
// statuses of unchanged proposals are preserved, and the result is stored on
// the job document.
//
// Guarded (lib/security/guard.ts): same-origin, session, per-user rate limit, daily AI budget.

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { Timestamp } from "firebase-admin/firestore";
import { chatCompletion, GlmError, textModel } from "@/lib/glm/client";
import { extractJson, ImportParseError } from "@/lib/import/parsed-resume";
import { readTagAliases } from "@/lib/db/meta";
import { patchJob, readJob, readPreferences, readProposals } from "@/lib/db/jobs";
import { scoreJob, scoreOptionsFor } from "@/lib/match/score";
import { reconcileRequirements } from "@/lib/match/reconcile";
import { readCandidateContext } from "@/lib/db/characterization";
import { readResumeBody } from "@/lib/match/resume-body";
import { recommendSelection } from "@/lib/match/recommend";
import { isMuted, newProposalId } from "@/lib/match/proposals";
import { PROPOSAL_SYSTEM_PROMPT, proposalUserMessage, type ProposalPromptItem } from "@/lib/match/prompt";
import type { Proposal } from "@/lib/match/types";
import { canonicalKey } from "@/lib/tags/normalize";
import { itemTitle } from "@/lib/sections";
import { toBullets } from "@/lib/typst/doc";
import { RESUME_LIST_KEYS, type ResumeData, type ResumeListKey } from "@/types/schema";
import { guardApi } from "@/lib/security/guard";
import { RATE } from "@/lib/security/rate-limit";
import { withAiUser } from "@/lib/security/ai-budget";
import { cleanModelText } from "@/lib/security/prompt";
import { readJsonBody } from "@/lib/security/request";

export const runtime = "nodejs";
export const maxDuration = 120;

const fail = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: Request) {
    const g = await guardApi(req, RATE.proposals, { ai: true, feature: "Job Match", what: "suggestion runs" });
    if (!g.ok) return g.response;
    const uid = g.uid;

    const parsed = await readJsonBody<{ jobId?: unknown; resume?: unknown }>(req);
    if (!parsed.ok) return parsed.response;
    const resume = readResumeBody(parsed.body.resume);
    if (typeof parsed.body.jobId !== "string" || !resume) return fail(400, "Expected `jobId` and `resume`.");
    const jobId = parsed.body.jobId;

    return withAiUser(uid, "proposals", async () => {
        const [job, prefs, aliases, candidate] = await Promise.all([readJob(uid, jobId), readPreferences(uid), readTagAliases(uid), readCandidateContext(uid)]);
        if (!job) return fail(404, "Job not found.");

        // Broader-context pass first: semantic matches feed both the score and the set cover.
        const reconciled = await reconcileRequirements(job.requirements, resume, aliases, { timeoutMs: 45_000, retries: 0, candidate, effort: "low" });
        const requirements = reconciled.requirements;
        if (reconciled.warning) console.warn("[jobs/proposals] reconcile skipped:", reconciled.warning);

        const match = scoreJob(requirements, resume, aliases, scoreOptionsFor(job));
        const rec = recommendSelection(requirements, resume, prefs.caps);

        // Items the coach may reference (all of them, so add-skill can cite unselected evidence).
        const items: ProposalPromptItem[] = [];
        const idIndex = new Map<string, { section: ResumeListKey; label: string; bullets: string[] }>();
        for (const key of RESUME_LIST_KEYS) {
            for (const item of resume[key] as ResumeData[ResumeListKey][number][]) {
                const bullets = "description" in item ? toBullets(item.description).slice(0, 8) : [];
                const label = itemTitle(key, item);
                idIndex.set(item.id, { section: key, label, bullets });
                items.push({ id: item.id, section: key, label: `${label}${item.isSelected ? "" : " (not included)"}`, bullets, tags: item.tags.map(t => t.display) });
            }
        }
        const mutedTags = prefs.mutedProposals.filter(r => r.tag).map(r => r.tag as string);
        const muted = requirements.filter(r => mutedTags.includes(r.name)).map(r => r.display);

        let llmProposals: Proposal[] = [];
        try {
            const result = await chatCompletion(
                [
                    { role: "system", content: PROPOSAL_SYSTEM_PROMPT },
                    { role: "user", content: proposalUserMessage({
                        job: { title: job.title, company: job.company, summary: job.summary },
                        requirements,
                        coverage: match.rows.map(r => ({ name: r.requirement.display, strength: r.strength, tier: r.tier })),
                        items,
                        skillCategories: resume.skills.map(s => ({ id: s.id, category: s.category, items: s.items })),
                        muted,
                        candidate,
                    }) },
                ],
                { model: textModel(), json: true, effort: "low", temperature: 0.3, maxTokens: 6000 },
            );
            const json = extractJson(result.text) as { proposals?: unknown };
            const reqByDisplay = new Map(requirements.map(r => [r.display.toLowerCase(), r.name]));
            const toKey = (t: unknown) => (typeof t === "string" ? reqByDisplay.get(t.toLowerCase()) ?? canonicalKey(t, aliases) : "");
            for (const raw of readProposals(
                Array.isArray(json.proposals) ? json.proposals.slice(0, 20).map((p, i) => ({ ...(p as object), id: `llm-${i}` })) : [],
            )) {
                if (raw.kind === "include" || raw.kind === "exclude") continue;
                const tags = raw.tags.map(toKey).filter(Boolean);
                const target = raw.itemId ? idIndex.get(raw.itemId) : undefined;
                if (raw.kind !== "gap" && !target) continue;
                if (raw.kind === "rewrite-bullet" && (!raw.proposed || !target?.bullets.length)) continue;
                if (raw.kind === "add-skill" && (!raw.proposed || target?.section !== "skills")) continue;
                llmProposals.push({
                    ...raw, tags, id: newProposalId(raw.kind), section: target?.section, itemLabel: target?.label,
                    current: raw.current === undefined ? undefined : cleanModelText(raw.current, 2000),
                    proposed: raw.proposed === undefined ? undefined : cleanModelText(raw.proposed, 600),
                    reason: cleanModelText(raw.reason, 600), status: "open",
                });
            }
        } catch (err) {
            if (err instanceof ImportParseError) console.error("[jobs/proposals] unparseable reply:", err.raw.slice(0, 500));
            else if (err instanceof GlmError) console.error("[jobs/proposals] GLM error:", err.message);
            else console.error("[jobs/proposals]", err);
            llmProposals = [];
            if (rec.include.length === 0 && rec.exclude.length === 0) return fail(502, "The AI could not produce suggestions right now. Please try again.");
        }

        // Preserve statuses of deterministic proposals the user already acted on.
        const previous = new Map(job.proposals.map(p => [p.id, p.status]));
        const all = [...rec.include, ...rec.exclude, ...llmProposals]
            .filter(p => !isMuted(p, prefs.mutedProposals))
            .map(p => ({ ...p, status: previous.get(p.id) ?? p.status }));

        await patchJob(uid, job.id, { proposals: all, proposalsAt: Timestamp.now(), lastScore: match.score, requirements });
        revalidatePath("/dashboard");
        return NextResponse.json({ ok: true, proposals: all, score: match.score, requirements, uncovered: rec.uncovered.map(r => r.display) });
    });
}
