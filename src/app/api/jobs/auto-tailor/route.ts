// src/app/api/jobs/auto-tailor/route.ts
// POST { jobId, resume: ResumeData } -> { ok, plan, requirements, warning? }.
// 1. reuse the background reconcile verdicts when they match this library, else a quick
//    inline pass (low effort) stored on the job;
// 2. deterministic plan (hard items locked, soft set cover) -> text-model review
//    limited to the soft side (lib/match/auto-tailor.ts). Uncovered hard
//    requirements do not block: the tailor window asks about them first and
//    warns about them. Nothing is persisted besides the reconciled requirements;
//    the window shows the plan as suggestions.
//
// Guarded (lib/security/guard.ts): same-origin, session, per-user rate limit, daily AI budget.

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { readJob } from "@/lib/db/jobs";
import { readResumeBody } from "@/lib/match/resume-body";
import { runTailorPlan } from "@/lib/match/tailor-run";
import { guardApi } from "@/lib/security/guard";
import { RATE } from "@/lib/security/rate-limit";
import { withAiUser } from "@/lib/security/ai-budget";
import { readJsonBody } from "@/lib/security/request";

export const runtime = "nodejs";
export const maxDuration = 300;

const fail = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: Request) {
    const g = await guardApi(req, RATE.tailor, { ai: true, feature: "Job Match", what: "tailoring runs" });
    if (!g.ok) return g.response;
    const uid = g.uid;

    const parsed = await readJsonBody<{ jobId?: unknown; resume?: unknown }>(req);
    if (!parsed.ok) return parsed.response;
    const resume = readResumeBody(parsed.body.resume);
    if (typeof parsed.body.jobId !== "string" || !resume) return fail(400, "Expected `jobId` and `resume`.");
    const jobId = parsed.body.jobId;

    return withAiUser(uid, "tailor", async () => {
        try {
            const job = await readJob(uid, jobId);
            if (!job) return fail(404, "Job not found.");
            const run = await runTailorPlan(uid, job, resume);
            revalidatePath("/dashboard");
            return NextResponse.json({ ok: true, plan: run.plan, requirements: run.requirements, warning: run.warning });
        } catch (err) {
            console.error("[jobs/auto-tailor] failed:", err);
            return fail(500, "Auto-tailor failed. Please try again.");
        }
    });
}
