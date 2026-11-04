// POST /api/ext/tailor/save {jobId, name, include: Record<itemId, boolean>, hidden: Record<itemId, string[]>}
// Saves the selection the side panel settled on as a résumé variant (without loading it into the
// working selection) and links it to the job, so Auto Fill attaches it and the score uses it.

import { revalidatePath } from "next/cache";
import { createVariantFromPlan } from "@/app/actions/variant-actions";
import { asUser } from "@/lib/db/session";
import { readJob, updateJobTracking } from "@/lib/db/jobs";
import { jobSummary, resumeForJob } from "@/lib/ext/match-summary";
import { applySelection } from "@/lib/match/auto-tailor";
import { selectedHidden, selectedIds } from "@/lib/variants";
import { extFail, extJson, extPreflight, guardExtension } from "@/lib/security/ext-guard";
import { RATE } from "@/lib/security/rate-limit";
import { readJsonBody } from "@/lib/security/request";
import { clampStr, isDocId } from "@/lib/validation/limits";

export const runtime = "nodejs";
export const OPTIONS = extPreflight;

function readSelection(include: unknown, hidden: unknown) {
    const inc: Record<string, boolean> = {};
    const hid: Record<string, string[]> = {};
    if (include && typeof include === "object") for (const [k, v] of Object.entries(include).slice(0, 2000)) if (isDocId(k) && typeof v === "boolean") inc[k] = v;
    if (hidden && typeof hidden === "object") for (const [k, v] of Object.entries(hidden).slice(0, 2000)) {
        if (isDocId(k) && Array.isArray(v)) hid[k] = v.filter((x): x is string => typeof x === "string").slice(0, 100).map(x => x.slice(0, 2000));
    }
    return { include: inc, hidden: hid };
}

export async function POST(req: Request) {
    const g = await guardExtension(req, RATE.save);
    if (!g.ok) return g.response;
    const body = await readJsonBody<{ jobId?: unknown; name?: unknown; include?: unknown; hidden?: unknown }>(req, 256 * 1024);
    if (!body.ok) return body.response;
    const { jobId, name } = body.body;
    if (typeof jobId !== "string" || !isDocId(jobId)) return extFail(req, 400, "Expected `jobId`.");
    const job = await readJob(g.uid, jobId);
    if (!job) return extFail(req, 404, "Job not found.");

    const { resume } = await resumeForJob(g.uid, job.variantId);
    const tailored = applySelection(resume, readSelection(body.body.include, body.body.hidden));
    const label = clampStr(typeof name === "string" ? name : "", 80) || [job.title, job.company].filter(Boolean).join(" · ").slice(0, 80) || "Tailored résumé";
    const created = await asUser(g.uid, () => createVariantFromPlan({ name: label, labels: ["extension"], items: selectedIds(tailored), hidden: selectedHidden(tailored), layout: resume.layout, load: false }));
    await updateJobTracking(g.uid, jobId, { variantId: created.id }, job);
    revalidatePath("/dashboard");
    const next = await readJob(g.uid, jobId);
    return extJson(req, { ok: true, variantId: created.id, summary: next ? await jobSummary(g.uid, next) : null });
}
