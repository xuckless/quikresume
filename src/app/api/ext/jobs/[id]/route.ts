// /api/ext/jobs/[id]
//   GET   -> match summary for the side panel (score on the linked variant, else the working selection)
//   PATCH {status?, variantId?} -> tracker status / linked résumé

import { revalidatePath } from "next/cache";
import { readJob, updateJobTracking } from "@/lib/db/jobs";
import { readVariant } from "@/lib/db/variants";
import { jobSummary } from "@/lib/ext/match-summary";
import { isJobStatus } from "@/lib/match/types";
import { extFail, extJson, extPreflight, guardExtension } from "@/lib/security/ext-guard";
import { RATE } from "@/lib/security/rate-limit";
import { readJsonBody } from "@/lib/security/request";
import { isDocId } from "@/lib/validation/limits";

export const runtime = "nodejs";
export const OPTIONS = extPreflight;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
    const g = await guardExtension(req, RATE.extRead);
    if (!g.ok) return g.response;
    const { id } = await ctx.params;
    if (!isDocId(id)) return extFail(req, 404, "Job not found.");
    const job = await readJob(g.uid, id);
    if (!job) return extFail(req, 404, "Job not found.");
    return extJson(req, { ok: true, summary: await jobSummary(g.uid, job) });
}

export async function PATCH(req: Request, ctx: Ctx) {
    const g = await guardExtension(req, RATE.extRead);
    if (!g.ok) return g.response;
    const { id } = await ctx.params;
    if (!isDocId(id)) return extFail(req, 404, "Job not found.");
    const body = await readJsonBody<{ status?: unknown; variantId?: unknown }>(req, 4 * 1024);
    if (!body.ok) return body.response;
    const job = await readJob(g.uid, id);
    if (!job) return extFail(req, 404, "Job not found.");

    const patch: { status?: typeof job.status; variantId?: string | null } = {};
    if (body.body.status !== undefined) {
        if (!isJobStatus(body.body.status)) return extFail(req, 400, "Unknown status.");
        patch.status = body.body.status;
    }
    if (body.body.variantId !== undefined) {
        const v = body.body.variantId;
        if (v === null) patch.variantId = null;
        else if (typeof v === "string" && isDocId(v) && (await readVariant(g.uid, v))) patch.variantId = v;
        else return extFail(req, 400, "Unknown résumé variant.");
    }
    await updateJobTracking(g.uid, id, patch, job);
    revalidatePath("/dashboard");
    const next = await readJob(g.uid, id);
    return extJson(req, { ok: true, summary: next ? await jobSummary(g.uid, next) : null });
}
