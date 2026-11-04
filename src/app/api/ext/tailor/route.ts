// POST /api/ext/tailor {jobId} -> quick tailor for the side panel.
// Starts from the résumé the extension would send for this job (linked variant, else the working
// selection), runs the same plan as the web Tailor window (lib/match/tailor-run.ts), trims it to one
// page with the server compiler, and returns the differences as suggestions plus before / after scores.
// Nothing is written except the reconciled requirements; saving is POST /api/ext/tailor/save.

import { readJob } from "@/lib/db/jobs";
import { resumeForJob } from "@/lib/ext/match-summary";
import { runTailorPlan } from "@/lib/match/tailor-run";
import { applySelection, diffSuggestions, fitToOnePage, planSelection, selectionOf } from "@/lib/match/auto-tailor";
import { scoreJob } from "@/lib/match/score";
import { itemTitle } from "@/lib/sections";
import { countResumePages } from "@/lib/typst/server-pdf";
import { withAiUser } from "@/lib/security/ai-budget";
import { extFail, extJson, extPreflight, guardExtension } from "@/lib/security/ext-guard";
import { RATE } from "@/lib/security/rate-limit";
import { readJsonBody } from "@/lib/security/request";
import { isDocId } from "@/lib/validation/limits";
import { RESUME_LIST_KEYS, type ResumeData } from "@/types/schema";

export const runtime = "nodejs";
export const maxDuration = 300;
export const OPTIONS = extPreflight;

export async function POST(req: Request) {
    const g = await guardExtension(req, RATE.tailor, { ai: true, feature: "Tailoring", what: "tailoring runs" });
    if (!g.ok) return g.response;
    const body = await readJsonBody<{ jobId?: unknown }>(req, 4 * 1024);
    if (!body.ok) return body.response;
    const jobId = body.body.jobId;
    if (typeof jobId !== "string" || !isDocId(jobId)) return extFail(req, 400, "Expected `jobId`.");
    const uid = g.uid;

    return withAiUser(uid, "tailor", async () => {
        try {
            const job = await readJob(uid, jobId);
            if (!job) return extFail(req, 404, "Job not found.");
            const { resume, source } = await resumeForJob(uid, job.variantId);
            const run = await runTailorPlan(uid, job, resume);

            const base = selectionOf(resume);
            const pagesOf = async (sel: ReturnType<typeof selectionOf>) => countResumePages(applySelection(resume, sel));
            const planned = { ...planSelection(run.plan), layout: resume.layout };
            let fitted: Awaited<ReturnType<typeof fitToOnePage>>;
            try {
                fitted = await fitToOnePage(run.plan, planned, resume, pagesOf);
            } catch (err) {
                console.error("[ext/tailor] page count failed", err);
                fitted = { selection: planned, trim: { items: [], keys: {} }, pages: 0 };
            }
            const suggestions = diffSuggestions(run.plan, fitted.selection, base, fitted.trim);
            const score = (r: ResumeData) => scoreJob(run.requirements, r, run.aliases, { titleSim: job.titleSim }).score;
            const labels: Record<string, string> = {};
            for (const key of RESUME_LIST_KEYS) for (const it of resume[key]) labels[it.id] = itemTitle(key, it as never);
            return extJson(req, {
                ok: true,
                source,
                before: score(resume),
                after: score(applySelection(resume, fitted.selection)),
                pages: fitted.pages,
                base,
                suggestions: suggestions.map(s => ({ ...s, label: labels[s.itemId] ?? "" })),
                warning: run.warning,
            });
        } catch (err) {
            console.error("[ext/tailor]", err);
            return extFail(req, 500, "Tailoring failed. Please try again.");
        }
    });
}
