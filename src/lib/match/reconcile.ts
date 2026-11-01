// src/lib/match/reconcile.ts
// Server-only: the "broader context" pass of Job Match. Exact tag matching
// misses what a human sees at once ("Bachelor of Science" satisfies
// "Bachelor's degree", five systems projects evidence "Computer Science", a
// "5-service architecture" is microservices). This asks the text model to
// reconcile the requirements that found no exact tag against the candidate's
// whole tag inventory and items, and writes the verdicts onto the
// requirements (`satisfiedBy`, `evidence`, `reason`) so the deterministic
// scorer (lib/match/score.ts) honours them on every client-side recompute.
//
// Never throws for model trouble: on failure the requirements come back
// unchanged (built-in hierarchy still applies) and `warning` is set.

import "server-only";
import type { ResumeData, ResumeListKey } from "@/types/schema";
import { RESUME_LIST_KEYS } from "@/types/schema";
import { chatCompletion, GlmError, textModel } from "@/lib/glm/client";
import { effortFor, maxTokensFor, type Effort } from "@/lib/glm/effort";
import { stableHash } from "@/lib/hash";
import { finishJobMatch } from "@/lib/db/jobs";
import { extractJson, ImportParseError } from "@/lib/import/parsed-resume";
import { aggregateTags } from "@/lib/tags/aggregate";
import { canonicalKey, type AliasMap } from "@/lib/tags/normalize";
import { itemTitle } from "@/lib/sections";
import { toBullets } from "@/lib/typst/doc";
import { RECONCILE_SYSTEM_PROMPT, reconcileUserMessage, type ProposalPromptItem, type ReconcileTagRow } from "@/lib/match/prompt";
import { cleanModelText } from "@/lib/security/prompt";
import type { Requirement } from "@/lib/match/types";
import type { CandidatePromptContext } from "@/lib/about/types";
import { reconcileHints, semanticEvidence } from "@/lib/match/evidence";

const MAX_TAGS = 400;
const MAX_ITEMS = 120;
const MAX_BULLETS = 6;
const MAX_BULLET_CHARS = 220;
/** Background runs live inside the route's 300 s maxDuration (Vercel), which also covers the work done before after(). */
const ROUTE_MAX_MS = 300_000;
const MAX_BACKGROUND_TIMEOUT_MS = 250_000;
/** Firestore writes after the model call, and the gap before the job reads as stalled. */
const FINISH_MARGIN_MS = 15_000;

/** Model timeout for a background run in a request that started at `requestStartedMs`. */
export function reconcileTimeoutMs(requestStartedMs: number): number {
    return Math.max(10_000, Math.min(MAX_BACKGROUND_TIMEOUT_MS, ROUTE_MAX_MS - (Date.now() - requestStartedMs) - FINISH_MARGIN_MS * 2));
}

/** How long the job reads as "running" for a run with this model timeout. */
export const reconcileRunningMs = (timeoutMs: number) => timeoutMs + FINISH_MARGIN_MS;

export interface ReconcileResult {
    requirements: Requirement[];
    /** Requirement keys whose verdict changed in this pass. */
    changed: string[];
    warning?: string;
}

/** Items the model may cite: the whole library (selection is irrelevant for "does the candidate have it"). */
export function reconcileItems(resume: ResumeData): ProposalPromptItem[] {
    const items: ProposalPromptItem[] = [];
    for (const key of RESUME_LIST_KEYS) {
        for (const item of resume[key] as ResumeData[ResumeListKey][number][]) {
            const bullets = "description" in item
                ? toBullets(item.description).slice(0, MAX_BULLETS).map(b => b.slice(0, MAX_BULLET_CHARS))
                : "details" in item && item.details ? [item.details.slice(0, MAX_BULLET_CHARS)] : "items" in item ? [item.items.slice(0, 400)] : [];
            items.push({ id: item.id, section: key, label: itemTitle(key, item), bullets, tags: item.tags.map(t => t.display) });
        }
    }
    return items.slice(0, MAX_ITEMS);
}

/**
 * Fingerprint of everything the reconcile verdicts depend on (items, tag inventory, requirements, brief),
 * independent of the selection. Equal hash = stored verdicts still apply (Tailor skips its own pass).
 */
export function reconcileLibraryHash(requirements: Requirement[], resume: ResumeData, candidate?: CandidatePromptContext | null): string {
    const inventory = aggregateTags(resume, { selectedOnly: false }).map(t => [t.name, t.kind, t.weight]);
    return stableHash(JSON.stringify([requirements.map(r => r.name), inventory, reconcileItems(resume), candidate?.briefHash ?? null]));
}

export async function reconcileRequirements(
    requirements: Requirement[],
    resume: ResumeData,
    aliases: AliasMap,
    /** Routes with a time budget pass a shorter timeout and no retry. */
    /** `effort` defaults to the reconcile effort (max); inline callers with a short budget pass "low". */
    opts: {
        timeoutMs?: number; retries?: number; candidate?: CandidatePromptContext | null; effort?: Effort;
        /** Similarity-search candidates per requirement (display name -> item ids with p), from lib/match/evidence.ts. */
        hints?: Record<string, { id: string; p: number }[]>;
    } = {},
): Promise<ReconcileResult> {
    const inventory = aggregateTags(resume, { selectedOnly: false });
    const tagByKey = new Map(inventory.map(t => [t.name, t]));
    const tagByDisplay = new Map(inventory.map(t => [t.display.toLowerCase(), t.name]));
    const items = reconcileItems(resume);
    const itemIds = new Set(items.map(i => i.id));

    // Every requirement goes in, even ones with an exact tag: an exact tag may sit on an
    // unselected item while the evidence the model cites is selected, and the scorer
    // only counts selected carriers.
    const cleared = (r: Requirement): Requirement => ({ ...r, satisfiedBy: [], evidence: [], reason: "" });
    if (requirements.length === 0 || items.length === 0) return { requirements: requirements.map(cleared), changed: [] };

    const candidateTags: ReconcileTagRow[] = inventory.slice(0, MAX_TAGS).map(t => ({ name: t.display, kind: t.kind, items: t.weight }));
    const effort = opts.effort ?? effortFor("reconcile");
    let matches: unknown;
    try {
        const result = await chatCompletion(
            [
                { role: "system", content: RECONCILE_SYSTEM_PROMPT },
                { role: "user", content: reconcileUserMessage({ requirements, candidateTags, items, candidate: opts.candidate, hints: opts.hints }) },
            ],
            { model: textModel(), json: true, effort, temperature: 0.1, maxTokens: maxTokensFor(effort, 6000), timeoutMs: opts.timeoutMs ?? 60_000, retries: opts.retries },
        );
        matches = (extractJson(result.text) as { matches?: unknown }).matches;
    } catch (err) {
        const warning = err instanceof ImportParseError ? "The AI match check could not be understood."
            : err instanceof GlmError ? err.message : "The AI match check failed.";
        console.error("[reconcile]", err instanceof ImportParseError ? err.raw.slice(0, 300) : err);
        return { requirements, changed: [], warning };
    }

    const byDisplay = new Map(requirements.map(r => [r.display.toLowerCase(), r]));
    const byKey = new Map(requirements.map(r => [r.name, r]));
    const verdicts = new Map<string, { satisfiedBy: string[]; evidence: string[]; reason: string }>();
    if (Array.isArray(matches)) {
        for (const raw of matches) {
            if (!raw || typeof raw !== "object") continue;
            const o = raw as Record<string, unknown>;
            if (typeof o.requirement !== "string") continue;
            const req = byDisplay.get(o.requirement.trim().toLowerCase()) ?? byKey.get(canonicalKey(o.requirement, aliases));
            if (!req) continue;
            const satisfiedBy = new Set<string>();
            for (const s of Array.isArray(o.satisfiedBy) ? o.satisfiedBy : []) {
                if (typeof s !== "string") continue;
                const key = tagByDisplay.get(s.trim().toLowerCase()) ?? canonicalKey(s, aliases);
                if (key && key !== req.name && tagByKey.has(key)) satisfiedBy.add(key);
            }
            const evidence = new Set<string>();
            for (const id of Array.isArray(o.evidence) ? o.evidence : []) if (typeof id === "string" && itemIds.has(id)) evidence.add(id);
            if (satisfiedBy.size === 0 && evidence.size === 0) continue;
            verdicts.set(req.name, {
                satisfiedBy: [...satisfiedBy].slice(0, 8),
                evidence: [...evidence].slice(0, 8),
                reason: typeof o.reason === "string" ? cleanModelText(o.reason, 200) : "",
            });
        }
    }

    const changed: string[] = [];
    const out = requirements.map(r => {
        const v = verdicts.get(r.name);
        const next: Requirement = v ? { ...r, ...v } : cleared(r);
        if (JSON.stringify([r.satisfiedBy, r.evidence]) !== JSON.stringify([next.satisfiedBy, next.evidence])) changed.push(r.name);
        return next;
    });
    return { requirements: out, changed };
}

/**
 * Background pass for a saved job (scheduled with `after()`; the job is already marked running).
 * Writes the verdicts plus the final match state; never throws. `update()` underneath, so a job
 * deleted while the model thinks is not recreated.
 */
export async function runReconcileJob(
    uid: string,
    job: { id: string; title: string; requirements: Requirement[] },
    resume: ResumeData,
    aliases: AliasMap,
    candidate: CandidatePromptContext | null,
    timeoutMs: number,
): Promise<void> {
    const libraryHash = reconcileLibraryHash(job.requirements, resume, candidate);
    const started = Date.now();
    try {
        // Semantic pass first (embeddings + reranker, seconds): its uncertain candidates become hints for the
        // LLM judge, and its hits are stored on the requirements whatever the judge does.
        const sem = await semanticEvidence(uid, job.requirements, resume, job.title);
        const withSemantic = job.requirements.map(r => ({ ...r, semantic: sem.byRequirement.get(r.name) ?? r.semantic ?? [] }));
        const rec = await reconcileRequirements(withSemantic, resume, aliases, {
            candidate, timeoutMs: Math.max(10_000, timeoutMs - (Date.now() - started)), retries: 0, hints: reconcileHints(withSemantic, sem),
        });
        const judged = rec.warning ? withSemantic : rec.requirements;
        // The judge saw these items: cited = confirmed, not cited = rejected. Without a verdict they stay unjudged (null).
        const final = judged.map(r => {
            // O*NET category match: named products count as satisfying tags (coverage "related").
            const tax = sem.taxonomy.get(r.name);
            const satisfiedBy = tax ? [...new Set([...r.satisfiedBy, ...tax.satisfiers])].slice(0, 12) : r.satisfiedBy;
            const reason = r.reason || (tax ? `Counts as ${tax.category.toLowerCase()} (O*NET).` : "");
            return {
                ...r, satisfiedBy, reason,
                semantic: r.semantic.map(h => ({ ...h, confirmed: rec.warning ? null : r.evidence.includes(h.itemId) })),
            };
        });
        const warning = rec.warning ?? undefined;
        await finishJobMatch(uid, job.id, warning
            ? { requirements: final, titleSim: sem.titleSim, libraryHash, warning }
            : { requirements: final, titleSim: sem.titleSim, libraryHash });
        if (sem.warning) console.warn("[reconcile] semantic:", sem.warning);
    } catch (err) {
        if ((err as { code?: number })?.code === 5) return; // job deleted meanwhile
        console.error("[reconcile] background run failed:", err);
        await finishJobMatch(uid, job.id, { libraryHash, warning: "The AI match check failed." }).catch(() => {});
    }
}
