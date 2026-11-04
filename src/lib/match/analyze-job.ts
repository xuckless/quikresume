// src/lib/match/analyze-job.ts
// Server-only: posting text -> requirements -> saved job, plus the background reconcile pass.
// Shared by POST /api/jobs/analyze (web form) and POST /api/ext/jobs (browser extension).
// Callers run it inside withAiUser(uid, "job-analyze", ...) and own guarding / input parsing.

import { cleanCompanyDomain } from "@/lib/jobs/company-domain";
import { isSeniority } from "@/lib/match/seniority";
import "server-only";
import { after } from "next/server";
import { chatCompletion, textModel } from "@/lib/glm/client";
import { extractJson } from "@/lib/import/parsed-resume";
import { readTagAliases } from "@/lib/db/meta";
import { createJob, countJobs, MAX_JOBS } from "@/lib/db/jobs";
import { readCandidateContext } from "@/lib/db/characterization";
import { reconcileRunningMs, reconcileTimeoutMs, runReconcileJob } from "@/lib/match/reconcile";
import { JD_SYSTEM_PROMPT, jdUserMessage } from "@/lib/match/prompt";
import { makeTag, type AliasMap } from "@/lib/tags/normalize";
import { isTagKind } from "@/lib/tags/types";
import { withAiUser } from "@/lib/security/ai-budget";
import { cleanModelText } from "@/lib/security/prompt";
import type { ResumeData } from "@/types/schema";
import type { JobPosting, JobRecord, JobSourceKind, JobTracking, Requirement } from "@/lib/match/types";

export class AnalyzeJobError extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
    }
}

export function parseRequirements(raw: unknown, aliases: AliasMap): Requirement[] {
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

export interface AnalyzeJobInput {
    /** Sanitised posting text (sanitizeForPrompt, JD_MAX_CHARS). */
    jdText: string;
    source: { kind: JobSourceKind; fileName: string | null };
    /** Page-provided values; the model's title / company fill in when these are empty. */
    hints?: { title?: string; company?: string };
    posting?: Partial<JobPosting>;
    tracking?: Partial<JobTracking>;
    /** Résumé for the background reconcile pass; null = no pass (job scores on tags). */
    resume: ResumeData | null;
    /** Request start, so the background pass fits in the route's maxDuration. */
    startedAt: number;
}

export async function analyzeAndSaveJob(uid: string, input: AnalyzeJobInput): Promise<JobRecord> {
    if ((await countJobs(uid)) >= MAX_JOBS) throw new AnalyzeJobError(`You can keep at most ${MAX_JOBS} jobs. Delete some first.`, 409);
    if (input.jdText.length < 40) throw new AnalyzeJobError("That job description is too short to analyse.", 400);

    const candidate = await readCandidateContext(uid);
    const result = await chatCompletion(
        [{ role: "system", content: JD_SYSTEM_PROMPT }, { role: "user", content: jdUserMessage(input.jdText, candidate) }],
        { model: textModel(), json: true, effort: "low", temperature: 0.1, maxTokens: 6000 },
    );
    const json = extractJson(result.text) as Record<string, unknown>;
    const aliases = await readTagAliases(uid);
    const requirements = parseRequirements(json.requirements, aliases);
    if (requirements.length === 0) throw new AnalyzeJobError("No requirements could be extracted from that text. Try the full posting.", 502);

    const reconcileTimeout = reconcileTimeoutMs(input.startedAt);
    const job = await createJob(uid, {
        title: cleanModelText(input.hints?.title ?? "", 120) || cleanModelText(String(json.title ?? ""), 120) || "Untitled job",
        company: cleanModelText(input.hints?.company ?? "", 120) || cleanModelText(String(json.company ?? ""), 120),
        summary: cleanModelText(String(json.summary ?? ""), 600),
        source: input.source,
        jdText: input.jdText,
        requirements,
        seniority: isSeniority(json.seniority) ? json.seniority : null,
        companyDomain: cleanCompanyDomain(json.companyDomain) ?? cleanCompanyDomain(input.posting?.url),
        fitNotes: candidate && Array.isArray(json.fitNotes)
            ? json.fitNotes.filter((n): n is string => typeof n === "string" && n.trim() !== "").slice(0, 2).map(n => cleanModelText(n, 200))
            : [],
        ...input.posting,
        ...input.tracking,
    }, { runningForMs: input.resume ? reconcileRunningMs(reconcileTimeout) : undefined });

    // The job opens at once, scored on exact tags; the broader-context pass fills in behind it.
    const resume = input.resume;
    if (resume) after(() => withAiUser(uid, "reconcile", () => runReconcileJob(uid, job, resume, aliases, candidate, reconcileTimeout)));
    return job;
}
