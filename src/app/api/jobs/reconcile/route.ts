// src/app/api/jobs/reconcile/route.ts
// POST { jobId, resume: ResumeData } -> { ok, job } with `job.match.status: "running"`.
// Re-runs the "broader context" pass (lib/match/reconcile.ts) for a saved job against the resume
// the user is scoring. The pass runs after the response (after()) and stores the verdicts
// on the job's requirements; the client polls while the job reads as running.
//
// Guarded (lib/security/guard.ts): same-origin, session, per-user rate limit, daily AI budget.

import { after, NextResponse } from "next/server";
import { readTagAliases } from "@/lib/db/meta";
import { markJobMatchRunning, readJob } from "@/lib/db/jobs";
import { reconcileRunningMs, reconcileTimeoutMs, runReconcileJob } from "@/lib/match/reconcile";
import { readResumeBody } from "@/lib/match/resume-body";
import { readCandidateContext } from "@/lib/db/characterization";
import { guardApi } from "@/lib/security/guard";
import { RATE } from "@/lib/security/rate-limit";
import { withAiUser } from "@/lib/security/ai-budget";
import { readJsonBody } from "@/lib/security/request";

export const runtime = "nodejs";
export const maxDuration = 300;

const fail = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });

/** GET ?jobId= -> { ok, status }: cheap poll target (one document read) while a background run is in flight. */
export async function GET(req: Request) {
    const g = await guardApi(req, RATE.poll, { what: "status checks" });
    if (!g.ok) return g.response;
    const jobId = new URL(req.url).searchParams.get("jobId");
    if (!jobId) return fail(400, "Expected `jobId`.");
    const job = await readJob(g.uid, jobId);
    if (!job) return fail(404, "Job not found.");
    return NextResponse.json({ ok: true, status: job.match.status });
}

export async function POST(req: Request) {
    const startedAt = Date.now();
    const g = await guardApi(req, RATE.reconcile, { ai: true, feature: "Job Match", what: "AI match checks" });
    if (!g.ok) return g.response;
    const uid = g.uid;

    const parsed = await readJsonBody<{ jobId?: unknown; resume?: unknown }>(req);
    if (!parsed.ok) return parsed.response;
    const resume = readResumeBody(parsed.body.resume);
    if (typeof parsed.body.jobId !== "string" || !resume) return fail(400, "Expected `jobId` and `resume`.");

    const [job, aliases, candidate] = await Promise.all([readJob(uid, parsed.body.jobId), readTagAliases(uid), readCandidateContext(uid)]);
    if (!job) return fail(404, "Job not found.");
    // A run already in flight (another tab, or the analysis that just finished) finishes on its own.
    if (job.match.status === "running") return NextResponse.json({ ok: true, job });

    const timeoutMs = reconcileTimeoutMs(startedAt);
    const match = await markJobMatchRunning(uid, job.id, reconcileRunningMs(timeoutMs), job.match);
    after(() => withAiUser(uid, "reconcile", () => runReconcileJob(uid, job, resume, aliases, candidate, timeoutMs)));
    return NextResponse.json({ ok: true, job: { ...job, match } });
}
