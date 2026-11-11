"use server"

import { revalidatePath } from "next/cache"
import { currentUid, requireUid } from "@/lib/db/session";
import { deleteJobDoc, isProposalStatus, patchJob, readJob, readJobs, readPreferences, sanitizeMuteRule, setJobScore, updateJobTracking, writePreferences } from "@/lib/db/jobs";
import { sameRule } from "@/lib/match/proposals";
import { clampStr } from "@/lib/validation/limits";
import { isJobStatus, type Caps, type JobRecord, type JobStatus, type JobTracking, type MuteRule, type Preferences, type ProposalStatus } from "@/lib/match/types";

export async function getJobs(): Promise<JobRecord[]> {
    const uid = await currentUid();
    if (!uid) return [];
    return readJobs(uid);
}

export async function getPreferences(): Promise<Preferences | null> {
    const uid = await currentUid();
    if (!uid) return null;
    return readPreferences(uid);
}

export async function deleteJob(id: string) {
    const uid = await requireUid();
    await deleteJobDoc(uid, id);
    revalidatePath("/dashboard");
}

export async function renameJob(id: string, title: string) {
    const uid = await requireUid();
    await patchJob(uid, id, { title: clampStr(title, 120) || "Untitled job" });
    revalidatePath("/dashboard");
}

/** Tracker column change (board drag or status menu). */
export async function setJobStatus(id: string, status: JobStatus) {
    const uid = await requireUid();
    if (!isJobStatus(status)) throw new Error("Invalid status");
    const job = await readJob(uid, id);
    if (!job) throw new Error("Job not found");
    await updateJobTracking(uid, id, { status }, job);
    revalidatePath("/dashboard");
}

/** Notes, applied date, linked variant. */
export async function updateJobMeta(id: string, patch: Pick<Partial<JobTracking>, "notes" | "appliedAt" | "variantId">) {
    const uid = await requireUid();
    const job = await readJob(uid, id);
    if (!job) throw new Error("Job not found");
    await updateJobTracking(uid, id, { notes: patch.notes, appliedAt: patch.appliedAt, variantId: patch.variantId }, job);
    revalidatePath("/dashboard");
}

export async function setProposalStatus(jobId: string, proposalId: string, status: ProposalStatus) {
    const uid = await requireUid();
    if (!isProposalStatus(status) || typeof proposalId !== "string" || proposalId.length > 64) throw new Error("Invalid proposal update");
    const job = await readJob(uid, jobId);
    if (!job) throw new Error("Job not found");
    const proposals = job.proposals.map(p => (p.id === proposalId ? { ...p, status } : p));
    await patchJob(uid, jobId, { proposals });
    revalidatePath("/dashboard");
}

export async function saveJobScore(jobId: string, score: number) {
    const uid = await requireUid();
    if (typeof score !== "number" || !Number.isFinite(score)) return;
    await setJobScore(uid, jobId, Math.max(0, Math.min(100, Math.round(score))));
    // Revalidate: the router keeps dynamic pages for 30 s (next.config staleTimes), so without it the tracker
    // reopened from the job page showed the cached older score. The caller saves only when the number changed.
    revalidatePath("/dashboard");
}

export async function muteProposal(input: MuteRule) {
    const uid = await requireUid();
    const rule = sanitizeMuteRule(input);
    if (!rule) throw new Error("Invalid rule");
    const prefs = await readPreferences(uid);
    if (!prefs.mutedProposals.some(r => sameRule(r, rule))) {
        await writePreferences(uid, { mutedProposals: [...prefs.mutedProposals, rule] });
    }
    revalidatePath("/dashboard");
}

export async function unmuteProposal(input: MuteRule) {
    const uid = await requireUid();
    const rule = sanitizeMuteRule(input);
    if (!rule) return;
    const prefs = await readPreferences(uid);
    await writePreferences(uid, { mutedProposals: prefs.mutedProposals.filter(r => !sameRule(r, rule)) });
    revalidatePath("/dashboard");
}

export async function saveCaps(caps: Caps) {
    const uid = await requireUid();
    await writePreferences(uid, { caps });
    revalidatePath("/dashboard");
}
