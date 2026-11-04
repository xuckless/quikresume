// src/lib/match/recommend.ts
// Which library items best cover a job's requirements under per-section caps: greedy maximisation of the
// scorer's own strength (lib/match/score.ts). Deterministic; the LLM only adds wording later. Pure.

import type { ResumeData, ResumeListKey } from "@/types/schema";
import { RESUME_LIST_KEYS } from "@/types/schema";
import { itemRecency } from "@/lib/sections";
import type { Caps, Proposal, Requirement } from "@/lib/match/types";
import { coverageItems } from "@/lib/match/coverage";
import { scoreJob } from "@/lib/match/score";

const REQ_WEIGHT = { must: 3, nice: 1 } as const;
/** Evidence at or above this counts as "covers" (proposal reasons, `covered`). */
const COVERS = 0.5;
/** Smallest weighted strength gain worth a slot (≈ a third of a nice requirement going 0 -> 0.85). */
const MIN_GAIN = 0.25;

interface Candidate {
    key: ResumeListKey;
    id: string;
    label: string;
    /** Requirement key -> evidence 0..1 this item gives (the scorer's own per-item evidence, recency included). */
    evidence: Map<string, number>;
    /** Requirement keys this item shows (evidence ≥ COVERS before recency decay: an older role still proves the skill). */
    tagNames: Set<string>;
    recency: string;
    selected: boolean;
    initialGain: number;
}

export interface Recommendation {
    /** Ids the algorithm would include. */
    chosen: Set<string>;
    include: Proposal[];
    exclude: Proposal[];
    /** Requirement keys whose chosen carriers reach COVERS strength. */
    covered: Set<string>;
    uncovered: Requirement[];
}

/**
 * Per-item evidence for every requirement, from scoreJob on the whole library (every item on, nothing
 * hidden), so selection and score agree on what counts: exact / related tags, reconcile citations,
 * semantic hits, recency.
 */
function libraryEvidence(requirements: Requirement[], data: ResumeData, now?: Date, recency = true): Map<string, Map<string, number>> {
    const all: ResumeData = { ...data };
    for (const key of RESUME_LIST_KEYS) {
        (all[key] as unknown[]) = (data[key] as { isSelected: boolean }[]).map(it => ({ ...it, isSelected: true, ...("hidden" in it ? { hidden: [] } : {}) }));
    }
    const byItem = new Map<string, Map<string, number>>();
    for (const row of scoreJob(requirements, all, {}, { now, recency }).rows) {
        for (const ev of row.evidence) {
            if (!ev.itemId || ev.itemId === "profile") continue;
            const m = byItem.get(ev.itemId) ?? new Map<string, number>();
            m.set(row.requirement.name, Math.max(m.get(row.requirement.name) ?? 0, ev.e));
            byItem.set(ev.itemId, m);
        }
    }
    return byItem;
}

/**
 * Greedy maximisation of Σ w_r · m_r, m_r = noisy-OR of the chosen items' evidence for r (the scorer's
 * strength), under per-section caps. The objective is monotone submodular, so greedy is within (1 − 1/e)
 * of the best selection; a weak extra carrier of an already strong requirement adds almost nothing.
 */
export function recommendSelection(requirements: Requirement[], data: ResumeData, caps: Caps, opts: { now?: Date } = {}): Recommendation {
    const reqByName = new Map(requirements.map(r => [r.name, r]));
    const miss = new Map<string, number>(requirements.map(r => [r.name, 1]));
    const gainOf = (c: Candidate) => {
        let g = 0;
        for (const [name, e] of c.evidence) {
            const r = reqByName.get(name);
            if (r) g += REQ_WEIGHT[r.importance] * (miss.get(name) ?? 0) * e;
        }
        return g;
    };

    const evidence = libraryEvidence(requirements, data, opts.now);
    const shown = libraryEvidence(requirements, data, opts.now, false);
    const units = new Map(coverageItems(data, false).map(u => [u.carrier.id, u]));
    const candidates: Candidate[] = [];
    for (const key of RESUME_LIST_KEYS) {
        for (const item of data[key] as ResumeData[ResumeListKey][number][]) {
            const ev = evidence.get(item.id) ?? new Map<string, number>();
            const c: Candidate = {
                key, id: item.id, label: units.get(item.id)?.carrier.label ?? "Untitled", evidence: ev,
                tagNames: new Set([...(shown.get(item.id) ?? [])].filter(([, e]) => e >= COVERS).map(([n]) => n)),
                recency: itemRecency(key, item), selected: item.isSelected, initialGain: 0,
            };
            c.initialGain = gainOf(c);
            candidates.push(c);
        }
    }

    const chosen = new Set<string>();
    const count: Partial<Record<ResumeListKey, number>> = {};
    const underCap = (key: ResumeListKey) => caps[key] === null || (count[key] ?? 0) < (caps[key] as number);
    const take = (c: Candidate) => {
        chosen.add(c.id);
        count[c.key] = (count[c.key] ?? 0) + 1;
        for (const [name, e] of c.evidence) if (miss.has(name)) miss.set(name, miss.get(name)! * (1 - e));
    };

    // Greedy loop: best marginal gain; ties -> newer, then already selected.
    for (;;) {
        let best: Candidate | null = null;
        let bestGain = MIN_GAIN;
        for (const c of candidates) {
            if (chosen.has(c.id) || !underCap(c.key)) continue;
            const g = gainOf(c);
            const better = g > bestGain + 1e-9 ||
                (best !== null && Math.abs(g - bestGain) <= 1e-9 && (c.recency > best.recency || (c.recency === best.recency && c.selected && !best.selected)));
            if (better) { best = c; bestGain = g; }
        }
        if (!best) break;
        take(best);
    }

    // Every skills category that carries at least one requirement is included (uncapped, cheap on space).
    for (const c of candidates) if (c.key === "skills" && !chosen.has(c.id) && c.tagNames.size > 0) take(c);

    // A resume needs an education entry: keep the most recent one if none was picked.
    const education = candidates.filter(c => c.key === "education");
    if (education.length > 0 && !education.some(c => chosen.has(c.id))) {
        const newest = [...education].sort((a, b) => (b.recency > a.recency ? 1 : b.recency < a.recency ? -1 : 0))[0];
        take(newest);
    }

    const covered = new Set<string>();
    for (const c of candidates) if (chosen.has(c.id)) c.tagNames.forEach(t => covered.add(t));
    const uncovered = requirements.filter(r => !covered.has(r.name));

    const reqLabel = (names: string[]) => names.map(n => reqByName.get(n)?.display ?? n);
    const include: Proposal[] = [];
    const exclude: Proposal[] = [];
    for (const c of candidates) {
        const reqs = [...c.tagNames].filter(t => reqByName.has(t));
        if (chosen.has(c.id) && !c.selected) {
            include.push({
                id: `include-${c.id}`, kind: "include", section: c.key, itemId: c.id, itemLabel: c.label, tags: reqs,
                reason: reqs.length ? `Covers ${reqLabel(reqs).join(", ")}.` : "Keeps the resume complete.", status: "open",
            });
        } else if (!chosen.has(c.id) && c.selected && c.key !== "education" && caps[c.key] !== null) {
            const over = (count[c.key] ?? 0) >= (caps[c.key] as number);
            if (c.tagNames.size === 0 || over) {
                exclude.push({
                    id: `exclude-${c.id}`, kind: "exclude", section: c.key, itemId: c.id, itemLabel: c.label, tags: reqs,
                    reason: c.tagNames.size === 0
                        ? "Matches none of the job's requirements; dropping it makes room."
                        : `Over the ${caps[c.key]}-item limit for this section; other items cover its keywords (${reqLabel(reqs).join(", ")}).`,
                    status: "open",
                });
            }
        }
    }
    return { chosen, include, exclude, covered, uncovered };
}
