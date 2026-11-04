// src/lib/match/tailor-run.ts
// Server-only: the tailor plan for one job and résumé. Shared by POST /api/jobs/auto-tailor (web Tailor
// window) and POST /api/ext/tailor (extension side panel). Callers own guarding and withAiUser.
//   1. reuse the background reconcile verdicts when they match this library, else a quick inline pass
//      (low effort) stored on the job;
//   2. deterministic plan (hard items locked, soft set cover) -> text-model review limited to the soft side.

import "server-only";
import { chatCompletion, GlmError, textModel } from "@/lib/glm/client";
import { extractJson, ImportParseError } from "@/lib/import/parsed-resume";
import { readTagAliases } from "@/lib/db/meta";
import { patchJob, readPreferences } from "@/lib/db/jobs";
import { readCandidateContext } from "@/lib/db/characterization";
import { reconcileLibraryHash, reconcileRequirements } from "@/lib/match/reconcile";
import { effortFor, maxTokensFor } from "@/lib/glm/effort";
import { buildTailorPlan, mergeAiReview, tailorPromptInput, type TailorPlan } from "@/lib/match/auto-tailor";
import { AUTO_TAILOR_SYSTEM_PROMPT, autoTailorUserMessage } from "@/lib/match/prompt";
import type { JobRecord, Requirement } from "@/lib/match/types";
import type { AliasMap } from "@/lib/tags/normalize";
import type { ResumeData } from "@/types/schema";

export interface TailorRun {
    plan: TailorPlan;
    requirements: Requirement[];
    aliases: AliasMap;
    caps: Awaited<ReturnType<typeof readPreferences>>["caps"];
    warning?: string;
}

export async function runTailorPlan(uid: string, job: JobRecord, resume: ResumeData): Promise<TailorRun> {
    const [prefs, aliases, candidate] = await Promise.all([readPreferences(uid), readTagAliases(uid), readCandidateContext(uid)]);
    const current = job.match.status === "done" && job.match.libraryHash === reconcileLibraryHash(job.requirements, resume, candidate);
    const reconciled = current
        ? { requirements: job.requirements, warning: undefined }
        : await reconcileRequirements(job.requirements, resume, aliases, { timeoutMs: 45_000, retries: 0, candidate, effort: "low" });
    const requirements = reconciled.requirements;
    if (!current && !reconciled.warning) await patchJob(uid, job.id, { requirements });

    const plan = buildTailorPlan(requirements, resume, prefs.caps, aliases);
    const warnings: string[] = reconciled.warning ? [`AI match check skipped: ${reconciled.warning}`] : [];
    let reviewed = plan;
    const effort = effortFor("tailor");
    try {
        const result = await chatCompletion(
            [
                { role: "system", content: AUTO_TAILOR_SYSTEM_PROMPT },
                { role: "user", content: autoTailorUserMessage({ job: { title: job.title, company: job.company, summary: job.summary }, ...tailorPromptInput(plan, resume, requirements), candidate }) },
            ],
            { model: textModel(), json: true, effort, temperature: 0.2, maxTokens: maxTokensFor(effort, 8000), timeoutMs: 180_000, retries: 0 },
        );
        reviewed = mergeAiReview(plan, resume, extractJson(result.text));
    } catch (err) {
        if (err instanceof ImportParseError) console.error("[tailor] unparseable reply:", err.raw.slice(0, 500));
        else console.error("[tailor]", err);
        warnings.push(`The AI review did not finish (${err instanceof GlmError ? err.message : "unreadable reply"}); showing the tag-based decisions.`);
    }
    return { plan: reviewed, requirements, aliases, caps: prefs.caps, warning: warnings.join(" ") || undefined };
}
