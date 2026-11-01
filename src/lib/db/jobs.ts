// src/lib/db/jobs.ts
// Server-only Firestore helpers for users/{uid}/jobs and Job Match preferences.

import "server-only";
import { Timestamp, type DocumentData } from "firebase-admin/firestore";
import { isoOf, strArray, strOf, userCol, userDoc } from "@/lib/db/user-collection";
import { readMeta, writeMeta } from "@/lib/db/meta";
import { isTagKind } from "@/lib/tags/types";
import { clampStr, isDocId } from "@/lib/validation/limits";
import { RESUME_LIST_KEYS, type ResumeListKey } from "@/types/schema";
import {
    DEFAULT_CAPS, IDLE_MATCH, isJobStatus, type Caps, type JobPosting, type JobTracking, type DeclinedSkill, type JobMatchState, type JobRecord, type MuteRule, type Preferences, type Proposal, type ProposalKind,
    type ProposalStatus, type Requirement, type SemanticHit,
} from "@/lib/match/types";

const KINDS = new Set<string>(["include", "exclude", "rewrite-bullet", "add-skill", "gap"]);
const STATUSES = new Set<string>(["open", "applied", "skipped", "ignored"]);
/** Saved jobs per user; the oldest are not pruned, new analyses are refused instead. */
export const MAX_JOBS = 200;

export const isProposalStatus = (v: unknown): v is ProposalStatus => typeof v === "string" && STATUSES.has(v);

const jobDoc = (uid: string, id: string) => userDoc(uid, "jobs", id);

/** A mute rule from a client: known kind, short strings, at least one of tag / itemId. */
export function sanitizeMuteRule(v: unknown): MuteRule | null {
    if (!v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    if (typeof o.kind !== "string" || !KINDS.has(o.kind)) return null;
    const tag = clampStr(o.tag, 120) || undefined;
    const itemId = isDocId(o.itemId) ? o.itemId : undefined;
    if (!tag && !itemId) return null;
    return { kind: o.kind as ProposalKind, tag, itemId };
}

export function readRequirements(v: unknown): Requirement[] {
    if (!Array.isArray(v)) return [];
    const out: Requirement[] = [];
    for (const r of v) {
        if (!r || typeof r !== "object") continue;
        const o = r as Record<string, unknown>;
        if (typeof o.name !== "string" || !o.name || !isTagKind(o.kind)) continue;
        out.push({
            name: o.name,
            display: typeof o.display === "string" && o.display ? o.display : o.name,
            kind: o.kind,
            importance: o.importance === "nice" ? "nice" : "must",
            yearsMin: typeof o.yearsMin === "number" ? o.yearsMin : null,
            satisfiedBy: strArray(o.satisfiedBy),
            evidence: strArray(o.evidence),
            reason: strOf(o.reason),
            semantic: readSemantic(o.semantic),
        });
    }
    return out;
}

function readSemantic(v: unknown): SemanticHit[] {
    if (!Array.isArray(v)) return [];
    const out: SemanticHit[] = [];
    for (const r of v.slice(0, 8)) {
        if (!r || typeof r !== "object") continue;
        const o = r as Record<string, unknown>;
        if (!isDocId(o.itemId) || typeof o.p !== "number" || !Number.isFinite(o.p)) continue;
        out.push({
            itemId: o.itemId,
            bullet: typeof o.bullet === "string" ? o.bullet : null,
            p: Math.max(0, Math.min(1, o.p)),
            quote: strOf(o.quote).slice(0, 200),
            reranked: o.reranked === true,
            confirmed: o.confirmed === true ? true : o.confirmed === false ? false : null,
        });
    }
    return out;
}

function readTitleSim(v: unknown): Record<string, number> {
    const out: Record<string, number> = {};
    if (v && typeof v === "object" && !Array.isArray(v)) {
        for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (isDocId(k) && typeof x === "number" && Number.isFinite(x)) out[k] = Math.max(0, Math.min(1, x));
    }
    return out;
}

export function readProposals(v: unknown): Proposal[] {
    if (!Array.isArray(v)) return [];
    const out: Proposal[] = [];
    for (const r of v) {
        if (!r || typeof r !== "object") continue;
        const o = r as Record<string, unknown>;
        if (typeof o.id !== "string" || typeof o.kind !== "string" || !KINDS.has(o.kind)) continue;
        out.push({
            id: o.id,
            kind: o.kind as ProposalKind,
            section: typeof o.section === "string" && (RESUME_LIST_KEYS as string[]).includes(o.section) ? (o.section as ResumeListKey) : undefined,
            itemId: typeof o.itemId === "string" ? o.itemId : undefined,
            itemLabel: typeof o.itemLabel === "string" ? o.itemLabel : undefined,
            tags: strArray(o.tags),
            current: typeof o.current === "string" ? o.current : undefined,
            proposed: typeof o.proposed === "string" ? o.proposed : undefined,
            reason: strOf(o.reason),
            status: typeof o.status === "string" && STATUSES.has(o.status) ? (o.status as ProposalStatus) : "open",
        });
    }
    return out;
}

export const MATCH_STALLED_WARNING = "The AI match check did not finish.";

export function readMatch(v: unknown): JobMatchState {
    if (!v || typeof v !== "object") return IDLE_MATCH;
    const o = v as Record<string, unknown>;
    const status = o.status === "running" || o.status === "done" || o.status === "failed" ? o.status : "idle";
    const runningUntil = isoOf(o.runningUntil);
    const match: JobMatchState = {
        status,
        runningUntil,
        checkedAt: isoOf(o.checkedAt),
        libraryHash: typeof o.libraryHash === "string" ? o.libraryHash : null,
        warning: strOf(o.warning),
    };
    // A function that died mid-run (platform timeout, crash) never writes "failed" itself.
    if (status === "running" && (!runningUntil || Date.parse(runningUntil) < Date.now())) {
        return { ...match, status: "failed", warning: match.warning || MATCH_STALLED_WARNING };
    }
    return match;
}

function mapJob(id: string, d: DocumentData): JobRecord {
    const src = (d.source ?? {}) as Record<string, unknown>;
    return {
        id,
        title: strOf(d.title),
        company: strOf(d.company),
        source: { kind: src.kind === "file" || src.kind === "extension" ? src.kind : "paste", fileName: typeof src.fileName === "string" ? src.fileName : null },
        jdText: strOf(d.jdText),
        summary: strOf(d.summary),
        requirements: readRequirements(d.requirements),
        proposals: readProposals(d.proposals),
        proposalsAt: isoOf(d.proposalsAt),
        lastScore: typeof d.lastScore === "number" ? d.lastScore : null,
        fitNotes: strArray(d.fitNotes),
        match: readMatch(d.match),
        titleSim: readTitleSim(d.titleSim),
        status: isJobStatus(d.status) ? d.status : "saved",
        appliedAt: typeof d.appliedAt === "string" ? d.appliedAt : null,
        notes: strOf(d.notes),
        variantId: isDocId(d.variantId) ? d.variantId : null,
        url: typeof d.url === "string" && d.url ? d.url : null,
        urlKey: typeof d.urlKey === "string" && d.urlKey ? d.urlKey : null,
        location: strOf(d.location),
        employmentType: strOf(d.employmentType),
        createdAt: isoOf(d.createdAt),
        updatedAt: isoOf(d.updatedAt),
    };
}

/** Fields the job list needs. `jdText` (up to 30k chars per job) stays on the server; nothing in the UI shows it. */
const LIST_FIELDS = [
    "title", "company", "source", "summary", "requirements", "proposals", "proposalsAt", "lastScore", "fitNotes", "match", "titleSim",
    "status", "appliedAt", "notes", "variantId", "url", "urlKey", "location", "employmentType", "createdAt", "updatedAt",
];

export const DEFAULT_TRACKING: JobTracking = { status: "saved", appliedAt: null, notes: "", variantId: null };
export const EMPTY_POSTING: JobPosting = { url: null, urlKey: null, location: "", employmentType: "" };

/** The user's jobs, newest first, without the pasted job description (see LIST_FIELDS). */
export async function readJobs(uid: string): Promise<JobRecord[]> {
    const snap = await userCol(uid, "jobs").orderBy("updatedAt", "desc").limit(MAX_JOBS).select(...LIST_FIELDS).get();
    return snap.docs.map(doc => mapJob(doc.id, doc.data()));
}

export async function countJobs(uid: string): Promise<number> {
    const snap = await userCol(uid, "jobs").count().get();
    return snap.data().count;
}

export async function readJob(uid: string, id: string): Promise<JobRecord | null> {
    if (!isDocId(id)) return null;
    const doc = await jobDoc(uid, id).get();
    const d = doc.data();
    return doc.exists && d ? mapJob(doc.id, d) : null;
}

/** Firestore shape of a match state (timestamps, not ISO strings). */
function matchDoc(m: { status: JobMatchState["status"]; runningUntilMs?: number | null; checkedAt?: Timestamp | null; libraryHash?: string | null; warning?: string }) {
    return {
        status: m.status,
        runningUntil: m.runningUntilMs ? Timestamp.fromMillis(m.runningUntilMs) : null,
        checkedAt: m.checkedAt ?? null,
        libraryHash: m.libraryHash ?? null,
        warning: m.warning ?? "",
    };
}

/** `runningForMs` set = a background reconcile starts right after (status "running"). */
export async function createJob(
    uid: string,
    input: Omit<JobRecord, "id" | "createdAt" | "updatedAt" | "proposals" | "proposalsAt" | "lastScore" | "match" | "titleSim" | keyof JobTracking | keyof JobPosting>
        & Partial<JobTracking> & Partial<JobPosting>,
    opts: { runningForMs?: number } = {},
): Promise<JobRecord> {
    const job = { ...DEFAULT_TRACKING, ...EMPTY_POSTING, ...input };
    const now = Timestamp.now();
    const runningUntilMs = opts.runningForMs ? now.toMillis() + opts.runningForMs : null;
    const match = matchDoc({ status: runningUntilMs ? "running" : "idle", runningUntilMs });
    const ref = await userCol(uid, "jobs").add({ ...job, match, titleSim: {}, proposals: [], proposalsAt: null, lastScore: null, createdAt: now, updatedAt: now });
    return {
        ...job,
        titleSim: {},
        id: ref.id,
        match: { ...IDLE_MATCH, status: match.status, runningUntil: runningUntilMs ? new Date(runningUntilMs).toISOString() : null },
        proposals: [],
        proposalsAt: null,
        lastScore: null,
        createdAt: now.toDate().toISOString(),
        updatedAt: now.toDate().toISOString(),
    };
}

/** Marks a background reconcile as running. No `updatedAt`, so the job list keeps its order until the result lands. */
export async function markJobMatchRunning(uid: string, id: string, runningForMs: number, prev: JobMatchState): Promise<JobMatchState> {
    const runningUntilMs = Date.now() + runningForMs;
    await jobDoc(uid, id).update({
        match: matchDoc({ status: "running", runningUntilMs, checkedAt: prev.checkedAt ? Timestamp.fromDate(new Date(prev.checkedAt)) : null, libraryHash: prev.libraryHash }),
    });
    return { ...prev, status: "running", runningUntil: new Date(runningUntilMs).toISOString(), warning: "" };
}

/** Final state of a reconcile run; `requirements` only when it produced verdicts. */
export async function finishJobMatch(
    uid: string,
    id: string,
    result: { requirements?: Requirement[]; titleSim?: Record<string, number>; libraryHash: string | null; warning?: string },
): Promise<void> {
    const ok = !result.warning;
    const match = matchDoc({ status: ok ? "done" : "failed", checkedAt: Timestamp.now(), libraryHash: ok ? result.libraryHash : null, warning: result.warning });
    const extra = result.titleSim ? { titleSim: result.titleSim } : {};
    if (result.requirements) await patchJob(uid, id, { requirements: result.requirements, match, ...extra });
    else await jobDoc(uid, id).update({ match, ...extra });
}

/**
 * Firestore rejects `undefined` anywhere in a document ("Cannot use undefined as a
 * Firestore value"), and proposals/requirements carry optional fields. Drop them.
 */
export function stripUndefined<T>(value: T): T {
    if (Array.isArray(value)) return value.map(stripUndefined) as T;
    if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).map(([k, v]) => [k, stripUndefined(v)]),
        ) as T;
    }
    return value;
}

export async function patchJob(uid: string, id: string, patch: Record<string, unknown>): Promise<void> {
    await jobDoc(uid, id).update({ ...stripUndefined(patch), updatedAt: Timestamp.now() });
}

/** Writes only `lastScore`: no `updatedAt`, so recording a score never reorders the job list. */
export async function setJobScore(uid: string, id: string, lastScore: number): Promise<void> {
    await jobDoc(uid, id).update({ lastScore });
}

/** The job imported from this canonical URL, if any (dedupe for the extension). */
export async function findJobByUrlKey(uid: string, urlKey: string): Promise<JobRecord | null> {
    const snap = await userCol(uid, "jobs").where("urlKey", "==", urlKey).limit(1).get();
    const doc = snap.docs[0];
    return doc ? mapJob(doc.id, doc.data()) : null;
}

/** Tracker update: status (stamps `appliedAt` the first time a job leaves "saved"), notes, linked variant. */
export async function updateJobTracking(uid: string, id: string, patch: Partial<JobTracking>, prev: JobTracking): Promise<void> {
    const data: Record<string, unknown> = {};
    if (patch.status !== undefined && isJobStatus(patch.status)) {
        data.status = patch.status;
        if (patch.status !== "saved" && !prev.appliedAt) data.appliedAt = new Date().toISOString().slice(0, 10);
    }
    if (patch.appliedAt !== undefined) data.appliedAt = patch.appliedAt && /^\d{4}-\d{2}-\d{2}$/.test(patch.appliedAt) ? patch.appliedAt : null;
    if (patch.notes !== undefined) data.notes = clampStr(patch.notes, 4000);
    if (patch.variantId !== undefined) data.variantId = isDocId(patch.variantId) ? patch.variantId : null;
    if (Object.keys(data).length) await patchJob(uid, id, data);
}

export async function deleteJobDoc(uid: string, id: string): Promise<void> {
    await jobDoc(uid, id).delete();
}

// ---------- preferences (users/{uid}/meta/preferences)

function readMuteRules(v: unknown): MuteRule[] {
    if (!Array.isArray(v)) return [];
    const out: MuteRule[] = [];
    for (const r of v) {
        if (!r || typeof r !== "object") continue;
        const o = r as Record<string, unknown>;
        if (typeof o.kind !== "string" || !KINDS.has(o.kind)) continue;
        out.push({ kind: o.kind as ProposalKind, tag: typeof o.tag === "string" ? o.tag : undefined, itemId: typeof o.itemId === "string" ? o.itemId : undefined });
    }
    return out;
}

function readCaps(v: unknown): Caps {
    const caps: Caps = { ...DEFAULT_CAPS };
    if (v && typeof v === "object") {
        for (const key of RESUME_LIST_KEYS) {
            const x = (v as Record<string, unknown>)[key];
            if (x === null) caps[key] = null;
            else if (typeof x === "number" && Number.isFinite(x) && x >= 0) caps[key] = Math.min(999, Math.floor(x));
        }
    }
    return caps;
}

function readDeclined(v: unknown): DeclinedSkill[] {
    if (!Array.isArray(v)) return [];
    const out: DeclinedSkill[] = [];
    for (const r of v) {
        if (!r || typeof r !== "object") continue;
        const o = r as Record<string, unknown>;
        if (typeof o.name !== "string" || !o.name) continue;
        out.push({ name: o.name, display: strOf(o.display) || o.name, at: typeof o.at === "string" ? o.at : null });
    }
    return out;
}

export async function readPreferences(uid: string): Promise<Preferences> {
    const d = await readMeta(uid, "preferences");
    return { mutedProposals: readMuteRules(d.mutedProposals), caps: readCaps(d.caps), declinedSoftSkills: readDeclined(d.declinedSoftSkills) };
}

const MAX_RULES = 300;

/** Every field is re-read through the same lenient readers Firestore data goes through, so a client cannot store arbitrary shapes. */
export async function writePreferences(uid: string, patch: Partial<Preferences>): Promise<void> {
    const data: Record<string, unknown> = {};
    if (patch.mutedProposals) {
        data.mutedProposals = readMuteRules(patch.mutedProposals).slice(-MAX_RULES).map(r => ({ kind: r.kind, tag: r.tag ? clampStr(r.tag, 120) : null, itemId: isDocId(r.itemId) ? r.itemId : null }));
    }
    if (patch.caps) data.caps = readCaps(patch.caps);
    if (patch.declinedSoftSkills) {
        data.declinedSoftSkills = readDeclined(patch.declinedSoftSkills).slice(-MAX_RULES).map(r => ({ name: clampStr(r.name, 120), display: clampStr(r.display, 120) || clampStr(r.name, 120), at: r.at ?? null }));
    }
    await writeMeta(uid, "preferences", data);
}
