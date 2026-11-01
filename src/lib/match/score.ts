// src/lib/match/score.ts
// Job-fit scoring, v2. Pure: runs in the browser for the live panel (every toggle recomputes) and on
// the server for proposals. Inputs are the requirements with their stored evidence (tags + the
// reconcile verdicts + semantic hits from lib/match/evidence.ts) and the résumé being scored.
//
// Per requirement r, the evidence of each selected item i is
//   e = 0.95  exact tag (credentials / languages: 1)        via "direct"
//       0.90  cited by the AI reconcile pass                 via "direct"
//       0.85  a satisfying tag (degree hierarchy, reconcile) via "related"
//       p     semantic hit (calibrated; confirmed by the judge -> ≥ 0.9; seen and rejected -> 0.4·p)
//   times recency 0.5^(age / 4y) for dated work (experience, projects, volunteering).
// strength m_r = 1 − Π(1 − e) over the top 3 items (noisy-OR: more evidence helps, with diminishing
// returns); binary kinds use the best e. A literal keyword hit with nothing better counts 0.5.
//
// Sub-scores (each 0..1, null when the posting gives nothing to measure):
//   coverage  C = Σ w·m / Σ w,  w = importance (must 1, nice 0.4) × tier (hard 1, soft 0.3)
//   ats       K = hard requirements' literal presence, by placement (recent role / skills / summary 1, elsewhere 0.6)
//   years     Y = mean over requirements with yearsMin of min(1, evidenced years / yearsMin)
//   title     T = best calibrated similarity of the job title to a selected role's title, with recency
//   education E = coverage of credential requirements
// score = 100 · Σ W·sub / Σ W over the non-null ones, W = {C .55, K .15, Y .10, T .10, E .10}.
// Must-have gate: any hard must-have with m < 0.3 caps the score at MUST_GATE_CAP (the knock-out
// a real screen applies), reported separately as "Must-haves x/y".
// band = 1.96 · √Var · weight of C, Var = Σ w² m(1−m) / (Σ w)² (each m read as a Bernoulli).
// gain_r = 100 · (W_C / ΣW) · w_r (1 − m_r) / Σ w: exact, because the score is linear in m_r.

import type { ResumeData, ResumeListKey } from "@/types/schema";
import { RESUME_LIST_KEYS } from "@/types/schema";
import { emptyKindTotals, type KindTotals } from "@/lib/tags/aggregate";
import { surfaceForms, type AliasMap } from "@/lib/tags/normalize";
import { toTypstDoc } from "@/lib/typst/doc";
import { literalHit, renderedText } from "@/lib/match/text";
import { coverageItems, requirementCoverage } from "@/lib/match/coverage";
import { itemAgeMonths, itemSpan } from "@/lib/match/units";
import { noisyOr, recencyWeight } from "@/lib/match/semantic";
import { bulletKey, bulletLines } from "@/lib/sub-items";
import { itemTitle } from "@/lib/sections";
import type { EvidenceVia, MatchResult, MatchRow, Requirement, RequirementTier, RowEvidence, SubScores } from "@/lib/match/types";

export const IMPORTANCE_WEIGHT: Record<Requirement["importance"], number> = { must: 1, nice: 0.4 };
export const TIER_WEIGHT: Record<RequirementTier, number> = { hard: 1, soft: 0.3 };
export const SUB_WEIGHTS = { coverage: 0.55, ats: 0.15, years: 0.1, title: 0.1, education: 0.1 } as const;
export const MUST_GATE_CAP = 70;
export const MUST_MISSING_BELOW = 0.3;
const BINARY_KINDS = new Set<Requirement["kind"]>(["credential", "language"]);
const DATED_WORK = new Set<ResumeListKey>(["workExperience", "projects", "volunteering"]);

/**
 * Generic engineering practices that postings list as "technical requirements"
 * but that no serious screen fails a candidate on. Treated as soft whatever
 * kind the JD model assigned. Keys are canonical tag keys.
 */
const PRACTICE_KEYS = new Set<string>([
    "software development lifecycle", "sdlc", "software development life cycle", "documentation", "technical documentation",
    "software testing", "testing", "code review", "code reviews", "debugging", "troubleshooting", "problem solving",
    "analytical thinking", "analytical skills", "communication", "written communication", "verbal communication", "collaboration",
    "teamwork", "version control", "best practices", "clean code", "software design", "design patterns", "requirements analysis",
    "requirements gathering", "technical writing", "attention to detail", "time management", "self-motivated", "mentoring",
    "leadership", "unit testing", "integration testing", "quality assurance", "continuous learning", "software engineering",
    "software development", "programming", "coding", "computer science fundamentals", "computer science",
]);

export function requirementTier(r: Requirement): RequirementTier {
    if (r.kind === "soft-skill" || r.kind === "methodology") return "soft";
    if (r.kind === "domain") return "soft";
    return PRACTICE_KEYS.has(r.name) && r.kind !== "credential" ? "soft" : "hard";
}

/** The document with every item selected (for "whole library" scoring). */
export function withAllSelected(data: ResumeData): ResumeData {
    const next: ResumeData = { ...data };
    for (const key of RESUME_LIST_KEYS) {
        (next[key] as unknown[]) = (data[key] as { isSelected: boolean }[]).map(it => ({ ...it, isSelected: true }));
    }
    return next;
}

type AnyItem = ResumeData[ResumeListKey][number] & { hidden?: string[]; description?: string };

/** Selected items by id, with the bullet keys still printed (hidden bullets don't count as evidence). */
function selectedIndex(data: ResumeData) {
    const out = new Map<string, { section: ResumeListKey; label: string; bullets: Set<string> | null }>();
    for (const section of RESUME_LIST_KEYS) {
        for (const item of data[section] as AnyItem[]) {
            if (!item.isSelected) continue;
            const hidden = new Set(item.hidden ?? []);
            const bullets = typeof item.description === "string" ? new Set(bulletLines(item.description).map(bulletKey).filter(k => !hidden.has(k))) : null;
            out.set(item.id, { section, label: itemTitle(section, item as ResumeData[typeof section][number]), bullets });
        }
    }
    return out;
}

/** Text of the places an ATS reader looks first: summary, skills, the most recent role. */
function primeText(doc: ReturnType<typeof toTypstDoc>): string {
    const recent = doc.experience[0];
    return [doc.summary, ...doc.skills.map(s => `${s.label} ${s.value}`), recent ? [recent.title, recent.company, ...recent.bullets].join("\n") : ""].join("\n");
}

function mergeSpans(spans: [number, number][]): number {
    const sorted = [...spans].sort((a, b) => a[0] - b[0]);
    let months = 0;
    let cur: [number, number] | null = null;
    for (const s of sorted) {
        if (!cur || s[0] > cur[1] + 1) { if (cur) months += cur[1] - cur[0] + 1; cur = [s[0], s[1]]; }
        else cur[1] = Math.max(cur[1], s[1]);
    }
    if (cur) months += cur[1] - cur[0] + 1;
    return months / 12;
}

export interface ScoreOptions {
    /** job.titleSim (lib/match/evidence.ts); absent = no title sub-score. */
    titleSim?: Record<string, number>;
    now?: Date;
}

export function scoreJob(requirements: Requirement[], data: ResumeData, aliases: AliasMap = {}, opts: ScoreOptions = {}): MatchResult {
    const now = opts.now ?? new Date();
    const selected = selectedIndex(data);
    const covItems = coverageItems(data, true);
    const tagsById = new Map(covItems.map(x => [x.carrier.id, new Set(x.tags.map(t => t.name))]));
    const coverage = requirementCoverage(requirements, covItems);
    const doc = toTypstDoc(data);
    const text = renderedText(doc);
    const prime = primeText(doc);
    const rec = (id: string) => {
        const it = selected.get(id);
        return it && DATED_WORK.has(it.section) ? recencyWeight(itemAgeMonths(data, it.section, id, now)) : 1;
    };

    const rows: MatchRow[] = requirements.map(r => {
        const cov = coverage.get(r.name);
        const binary = BINARY_KINDS.has(r.kind);
        const best = new Map<string, RowEvidence>();
        const offer = (itemId: string, label: string, via: EvidenceVia, e: number, quote = "") => {
            const ev = Math.max(0, Math.min(1, e * rec(itemId)));
            const prev = best.get(itemId);
            if (!prev || ev > prev.e) best.set(itemId, { itemId, label, via, e: ev, quote });
        };
        // Tag coverage (exact key / satisfying keys / reconcile citations).
        for (const c of cov?.items ?? []) {
            if (c.id === "profile") { offer("profile", c.label, "direct", 0.8); continue; }
            const exact = tagsById.get(c.id)?.has(r.name) ?? false;
            if (exact) offer(c.id, c.label, "direct", binary ? 1 : 0.95);
            else if (r.evidence.includes(c.id)) offer(c.id, c.label, "direct", 0.9);
            else offer(c.id, c.label, "related", 0.85);
        }
        // Semantic hits on selected items whose quoted bullet is still printed.
        for (const h of r.semantic ?? []) {
            const it = selected.get(h.itemId);
            if (!it) continue;
            if (h.bullet !== null && it.bullets && !it.bullets.has(h.bullet)) continue;
            const e = h.confirmed === true ? Math.max(h.p, 0.9) : h.confirmed === false && h.p < 0.85 ? 0.4 * h.p : h.p;
            offer(h.itemId, it.label, h.confirmed === true ? "direct" : "semantic", e, h.quote);
        }
        const evidence = [...best.values()].sort((a, b) => b.e - a.e);
        const literal = literalHit(text, [r.display, ...surfaceForms(r.name, aliases)]);
        let m = binary ? (evidence[0]?.e ?? 0) : noisyOr(evidence.slice(0, 3).map(x => x.e));
        if (binary && m >= 0.85) m = 1;
        if (literal && m < 0.5) {
            m = 0.5;
            if (evidence.length === 0) evidence.push({ itemId: "", label: "Printed on the résumé", via: "keyword", e: 0.5, quote: "" });
        }

        let years: MatchRow["years"] = null;
        if (r.yearsMin) {
            const spans = evidence.filter(x => x.e >= 0.6 && x.itemId && DATED_WORK.has(selected.get(x.itemId)?.section ?? "skills"))
                .map(x => itemSpan(data, selected.get(x.itemId)!.section, x.itemId, now)).filter((s): s is [number, number] => s !== null);
            years = { have: Math.round(mergeSpans(spans) * 10) / 10, need: r.yearsMin };
        }
        const placement = literalHit(prime, [r.display, ...surfaceForms(r.name, aliases)]) ? 1 : literal ? 0.6 : 0;
        const tagHit = (cov?.items.length ?? 0) > 0;
        const inferred = tagHit && (cov!.via.length > 0 || cov!.items.some(i => r.evidence.includes(i.id)));
        return {
            requirement: r, tier: requirementTier(r), strength: m, tagHit, weight: cov?.items.length ?? 0, literalHit: literal,
            items: cov?.items ?? [], via: cov?.viaDisplay ?? [], reason: inferred ? r.reason : "",
            evidence, gain: 0, years, placement,
        };
    });

    const w = (r: MatchRow) => IMPORTANCE_WEIGHT[r.requirement.importance] * TIER_WEIGHT[r.tier];
    const sumW = rows.reduce((s, r) => s + w(r), 0);
    const C = sumW > 0 ? rows.reduce((s, r) => s + w(r) * r.strength, 0) / sumW : 0;

    const hard = rows.filter(r => r.tier === "hard");
    const hardW = hard.reduce((s, r) => s + w(r), 0);
    const K = hardW > 0 ? hard.reduce((s, r) => s + w(r) * r.placement, 0) / hardW : null;

    const withYears = rows.filter(r => r.years);
    const yW = withYears.reduce((s, r) => s + w(r), 0);
    const Y = yW > 0 ? withYears.reduce((s, r) => s + w(r) * Math.min(1, r.years!.have / r.years!.need), 0) / yW : null;

    let T: number | null = null;
    if (opts.titleSim && Object.keys(opts.titleSim).length > 0) {
        for (const [id, sim] of Object.entries(opts.titleSim)) {
            if (!selected.has(id)) continue;
            T = Math.max(T ?? 0, sim * rec(id));
        }
    }

    const creds = rows.filter(r => r.requirement.kind === "credential");
    const cW = creds.reduce((s, r) => s + w(r), 0);
    const E = cW > 0 ? creds.reduce((s, r) => s + w(r) * r.strength, 0) / cW : null;

    const subScores: SubScores = { coverage: C, ats: K, years: Y, title: T, education: E };
    let total = 0;
    let sumSub = 0;
    for (const [k, v] of Object.entries(subScores) as [keyof SubScores, number | null][]) {
        if (v === null) continue;
        total += SUB_WEIGHTS[k] * v;
        sumSub += SUB_WEIGHTS[k];
    }
    const coverageShare = sumSub > 0 ? SUB_WEIGHTS.coverage / sumSub : 1;
    let score = sumSub > 0 ? (100 * total) / sumSub : 0;

    const missingMustRows = rows.filter(r => r.requirement.importance === "must" && r.tier === "hard" && r.strength < MUST_MISSING_BELOW);
    const gated = missingMustRows.length > 0 && score > MUST_GATE_CAP;
    if (gated) score = MUST_GATE_CAP;

    for (const r of rows) r.gain = sumW > 0 ? Math.round((100 * coverageShare * w(r) * (1 - r.strength)) / sumW * 10) / 10 : 0;
    const variance = sumW > 0 ? rows.reduce((s, r) => s + w(r) ** 2 * r.strength * (1 - r.strength), 0) / sumW ** 2 : 0;
    const band = Math.round(1.96 * Math.sqrt(variance) * 100 * coverageShare);

    const must = rows.filter(r => r.requirement.importance === "must");
    const nice = rows.filter(r => r.requirement.importance === "nice");
    const order = (r: MatchRow) => (r.requirement.importance === "must" ? 0 : 1);
    const tierOrder = (r: MatchRow) => (r.tier === "hard" ? 0 : 1);
    rows.sort((a, b) => order(a) - order(b) || tierOrder(a) - tierOrder(b) || a.strength - b.strength || a.requirement.display.localeCompare(b.requirement.display));

    return {
        score: Math.round(score),
        band,
        subScores,
        gated,
        must: { hit: must.filter(r => r.strength >= 0.5).length, total: must.length },
        nice: { hit: nice.filter(r => r.strength >= 0.5).length, total: nice.length },
        rows,
        missingMust: missingMustRows.map(r => r.requirement),
        keywordGaps: rows.filter(r => r.strength < MUST_MISSING_BELOW && r.tier === "soft").map(r => r.requirement),
    };
}

/**
 * Requirements nothing in the library covers (every item switched on): hard ones of any
 * importance plus soft keyword gaps. What the tailor window's questionnaire asks about.
 */
export function uncoveredRequirements(requirements: Requirement[], library: ResumeData, aliases: AliasMap = {}): Requirement[] {
    return scoreJob(requirements, withAllSelected(library), aliases).rows.filter(r => r.strength < MUST_MISSING_BELOW).map(r => r.requirement);
}

/** Kind totals for the job side of a radar (must = 2, nice = 1). */
export function jobKindTotals(requirements: Requirement[]): KindTotals {
    const totals = emptyKindTotals();
    for (const r of requirements) totals[r.kind] += r.importance === "must" ? 2 : 1;
    return totals;
}
