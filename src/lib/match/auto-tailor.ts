// src/lib/match/auto-tailor.ts
// Tailor window: suggest a job-specific selection. Pure and isomorphic.
//
//   1. buildTailorPlan: deterministic. Items covering a HARD requirement are
//      locked (suggested on, warned about when switched off); the remaining
//      items follow the set cover over the SOFT requirements
//      (lib/match/recommend.ts). Bullets / skills that literally name a hard
//      requirement are protected (suggested shown, warned about when hidden).
//   2. mergeAiReview: the text model confirms or flips the unlocked decisions
//      and may hide unprotected bullets / skills. Anything touching a locked
//      include, a protected line, an unknown id or index is ignored.
//   3. trimSteps: the order in which content is removed until the résumé
//      compiles to one page (bullets of weak unlocked items first, then those
//      items, then unprotected bullets of locked items).
//   4. The window never applies a plan: it edits a TailorSelection that starts
//      as the working selection, and the plan (plus trims) is shown as
//      suggestions (diffSuggestions) the user accepts, dismisses or ignores.

import type { ResumeLayout } from "@/lib/layout/types";
import type { ResumeData, ResumeListKey } from "@/types/schema";
import { RESUME_LIST_KEYS } from "@/types/schema";
import type { AliasMap } from "@/lib/tags/normalize";
import { surfaceForms } from "@/lib/tags/normalize";
import { itemRecency, itemTitle } from "@/lib/sections";
import { toBullets } from "@/lib/typst/doc";
import { bulletEntries, pruneHidden, skillEntries, type SubItem } from "@/lib/sub-items";
import { coverageItems, coveredByItem, requirementCoverage, satisfierIndex } from "@/lib/match/coverage";
import { recommendSelection } from "@/lib/match/recommend";
import { requirementTier } from "@/lib/match/score";
import { literalHit } from "@/lib/match/text";
import type { Caps, Requirement } from "@/lib/match/types";

export type DecisionSource = "tagging" | "ai-kept" | "ai-changed";

export interface TailorDecision {
    id: string;
    section: ResumeListKey;
    label: string;
    include: boolean;
    /** Covers a hard requirement (or is the kept education entry): suggested on, warned about when off. */
    locked: boolean;
    /** Display names of the hard / soft requirements the item covers. */
    hard: string[];
    soft: string[];
    /** Requirement keys behind `hard`. */
    hardKeys: string[];
    source: DecisionSource;
    reason: string;
    recency: string;
}

export interface TailorPlan {
    items: TailorDecision[];
    /** item id -> hidden bullet / skill keys in the suggested résumé. */
    hidden: Record<string, string[]>;
    /** item id -> key -> why it is hidden (AI). */
    hiddenReasons: Record<string, Record<string, string>>;
    /** item id -> keys that name a hard requirement (never hidden by the plan). */
    protectedKeys: Record<string, string[]>;
    /** item id -> key -> display names of the hard requirements the line names. */
    protectedBy: Record<string, Record<string, string[]>>;
}

/** What the window edits: item on/off and hidden sub-items, by item id. */
export interface TailorSelection {
    include: Record<string, boolean>;
    hidden: Record<string, string[]>;
    /** Section / item order reordered in the tailor window; absent = the library's layout. Suggestions ignore it. */
    layout?: ResumeLayout;
}

export type TrimStep = { kind: "bullet"; id: string; key: string } | { kind: "item"; id: string };

const BULLET_SECTIONS = new Set<ResumeListKey>(["workExperience", "projects", "volunteering", "custom"]);
const MAX_PROMPT_BULLETS = 10;
const MAX_BULLET_CHARS = 240;

type AnyItem = ResumeData[ResumeListKey][number];

/** Bullets or skills of an item, in document order (empty for sections without sub-items). */
export function subEntriesOf(section: ResumeListKey, item: AnyItem): SubItem[] {
    if (section === "skills") return skillEntries((item as ResumeData["skills"][number]).items);
    if (BULLET_SECTIONS.has(section)) return bulletEntries(toBullets((item as ResumeData["workExperience"][number]).description));
    return [];
}

const join = (names: string[]) => names.join(", ");

export function buildTailorPlan(requirements: Requirement[], resume: ResumeData, caps: Caps, aliases: AliasMap = {}): TailorPlan {
    const hardReqs = requirements.filter(r => requirementTier(r) === "hard");
    const softReqs = requirements.filter(r => requirementTier(r) === "soft");
    const display = new Map(requirements.map(r => [r.name, r.display]));

    const units = coverageItems(resume, false);
    const inventory = new Set<string>();
    for (const u of units) for (const t of u.tags) inventory.add(t.name);
    const index = satisfierIndex(requirements, inventory);
    const unitById = new Map(units.map(u => [u.carrier.id, u]));
    const chosen = recommendSelection(softReqs, resume, caps).chosen;
    const hardForms = hardReqs.map(r => [r.display, ...surfaceForms(r.name, aliases)]);

    const items: TailorDecision[] = [];
    const hidden: Record<string, string[]> = {};
    const protectedKeys: Record<string, string[]> = {};
    const protectedBy: Record<string, Record<string, string[]>> = {};

    for (const key of RESUME_LIST_KEYS) {
        for (const item of resume[key] as AnyItem[]) {
            const unit = unitById.get(item.id);
            const hardKeys = unit ? [...coveredByItem(unit, hardReqs, index)] : [];
            const hard = hardKeys.map(n => display.get(n) ?? n);
            const soft = unit ? [...coveredByItem(unit, softReqs, index)].map(n => display.get(n) ?? n) : [];
            const locked = hard.length > 0;
            const include = locked || chosen.has(item.id);
            const reason = locked ? `Covers hard requirement${hard.length > 1 ? "s" : ""}: ${join(hard)}.`
                : include ? (soft.length ? `Covers ${join(soft)}.` : "Keeps the résumé complete.")
                : soft.length ? `Other included items already cover ${join(soft)}.`
                : "Matches none of this job's requirements.";
            items.push({ id: item.id, section: key, label: itemTitle(key, item), include, locked, hard, soft, hardKeys, source: "tagging", reason, recency: itemRecency(key, item) });

            const entries = subEntriesOf(key, item);
            if (entries.length === 0) continue;
            const named: Record<string, string[]> = {};
            for (const e of entries) {
                const reqs = hardReqs.filter((_, i) => literalHit(e.label, hardForms[i])).map(r => r.display);
                if (reqs.length) named[e.key] = reqs;
            }
            const prot = Object.keys(named);
            if (prot.length) { protectedKeys[item.id] = prot; protectedBy[item.id] = named; }
            const keep = pruneHidden((item as { hidden?: string[] }).hidden, entries).filter(k => !prot.includes(k));
            if (keep.length) hidden[item.id] = keep;
        }
    }

    // A résumé needs an education entry: lock the newest one if none is locked.
    const education = items.filter(d => d.section === "education");
    if (education.length > 0 && !education.some(d => d.locked)) {
        const newest = [...education].sort((a, b) => (b.recency > a.recency ? 1 : b.recency < a.recency ? -1 : 0))[0];
        newest.locked = true;
        newest.include = true;
        newest.reason = "A résumé needs an education entry; this is the most recent.";
    }

    return { items, hidden, hiddenReasons: {}, protectedKeys, protectedBy };
}

// ---------- prompt input

export function tailorPromptInput(plan: TailorPlan, resume: ResumeData, requirements: Requirement[]) {
    const byId = new Map<string, AnyItem>();
    for (const key of RESUME_LIST_KEYS) for (const it of resume[key] as AnyItem[]) byId.set(it.id, it);
    const bulletsOf = (d: TailorDecision) => {
        if (!BULLET_SECTIONS.has(d.section)) return [];
        const prot = new Set(plan.protectedKeys[d.id] ?? []);
        return subEntriesOf(d.section, byId.get(d.id)!).slice(0, MAX_PROMPT_BULLETS)
            .map((e, i) => ({ i, text: e.label.slice(0, MAX_BULLET_CHARS), protected: prot.has(e.key) }));
    };
    return {
        hardRequirements: requirements.filter(r => requirementTier(r) === "hard").map(r => r.display),
        softRequirements: requirements.filter(r => requirementTier(r) === "soft").map(r => ({ name: r.display, importance: r.importance })),
        locked: plan.items.filter(d => d.locked).map(d => ({ id: d.id, section: d.section, label: d.label, bullets: bulletsOf(d) })),
        candidates: plan.items.filter(d => !d.locked).map(d => {
            const prot = new Set(plan.protectedKeys[d.id] ?? []);
            return {
                id: d.id, section: d.section, label: d.label, proposed: d.include ? "include" as const : "exclude" as const, covers: d.soft,
                bullets: bulletsOf(d),
                skills: d.section === "skills" ? subEntriesOf(d.section, byId.get(d.id)!).map(e => ({ name: e.label, protected: prot.has(e.key) })) : [],
            };
        }),
    };
}

// ---------- AI review

const str = (v: unknown, max = 240) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Applies the model's verdicts under the locking / protection rules. Returns a new plan. */
export function mergeAiReview(plan: TailorPlan, resume: ResumeData, raw: unknown): TailorPlan {
    const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const items = plan.items.map(d => ({ ...d }));
    const byId = new Map(items.map(d => [d.id, d]));
    const hidden: Record<string, string[]> = Object.fromEntries(Object.entries(plan.hidden).map(([k, v]) => [k, [...v]]));
    const hiddenReasons: Record<string, Record<string, string>> = {};
    const itemById = new Map<string, AnyItem>();
    for (const key of RESUME_LIST_KEYS) for (const it of resume[key] as AnyItem[]) itemById.set(it.id, it);

    for (const v of Array.isArray(o.items) ? o.items : []) {
        if (!v || typeof v !== "object") continue;
        const x = v as Record<string, unknown>;
        const d = typeof x.id === "string" ? byId.get(x.id) : undefined;
        if (!d || d.locked || typeof x.include !== "boolean") continue;
        const reason = str(x.reason);
        d.source = x.include === d.include ? "ai-kept" : "ai-changed";
        d.include = x.include;
        if (reason) d.reason = reason;
    }

    const hide = (id: string, key: string, reason: string) => {
        if ((plan.protectedKeys[id] ?? []).includes(key)) return;
        const list = (hidden[id] ??= []);
        if (!list.includes(key)) list.push(key);
        (hiddenReasons[id] ??= {})[key] = reason || "Not relevant to this job.";
    };

    for (const v of Array.isArray(o.hideBullets) ? o.hideBullets : []) {
        if (!v || typeof v !== "object") continue;
        const x = v as Record<string, unknown>;
        const d = typeof x.id === "string" ? byId.get(x.id) : undefined;
        if (!d || !BULLET_SECTIONS.has(d.section) || typeof x.i !== "number") continue;
        const entry = subEntriesOf(d.section, itemById.get(d.id)!)[x.i];
        if (entry) hide(d.id, entry.key, str(x.reason));
    }
    for (const v of Array.isArray(o.hideSkills) ? o.hideSkills : []) {
        if (!v || typeof v !== "object") continue;
        const x = v as Record<string, unknown>;
        const d = typeof x.id === "string" ? byId.get(x.id) : undefined;
        if (!d || d.section !== "skills" || typeof x.name !== "string") continue;
        const entries = subEntriesOf(d.section, itemById.get(d.id)!);
        const entry = entries.find(e => e.label.toLowerCase() === (x.name as string).trim().toLowerCase());
        // Never hide every skill of a category through the AI.
        if (entry && (hidden[d.id]?.length ?? 0) < entries.length - 1) hide(d.id, entry.key, str(x.reason));
    }

    return { ...plan, items, hidden, hiddenReasons };
}

// ---------- selections

const isSubSection = (key: ResumeListKey) => key === "skills" || BULLET_SECTIONS.has(key);

/** The working selection of a résumé (hidden keys pruned to the current text). */
export function selectionOf(resume: ResumeData): TailorSelection {
    const include: Record<string, boolean> = {};
    const hidden: Record<string, string[]> = {};
    for (const key of RESUME_LIST_KEYS) {
        for (const it of resume[key] as AnyItem[]) {
            include[it.id] = it.isSelected;
            if (!isSubSection(key)) continue;
            const keys = pruneHidden((it as { hidden?: string[] }).hidden, subEntriesOf(key, it));
            if (keys.length) hidden[it.id] = keys;
        }
    }
    return { include, hidden, layout: resume.layout };
}

/** The selection a plan suggests. */
export function planSelection(plan: TailorPlan): TailorSelection {
    return {
        include: Object.fromEntries(plan.items.map(d => [d.id, d.include || d.locked])),
        hidden: Object.fromEntries(Object.entries(plan.hidden).map(([id, keys]) => [id, [...keys]])),
    };
}

/** The résumé with the selection's `isSelected`, hidden sub-items and (when set) layout. */
export function applySelection(resume: ResumeData, sel: TailorSelection): ResumeData {
    const next: ResumeData = { ...resume, layout: sel.layout ?? resume.layout };
    for (const key of RESUME_LIST_KEYS) {
        (next[key] as unknown[]) = (resume[key] as AnyItem[]).map(it => {
            const base = { ...it, isSelected: sel.include[it.id] ?? false };
            return isSubSection(key) ? { ...base, hidden: sel.hidden[it.id] ?? [] } : base;
        });
    }
    return next;
}

const isHidden = (sel: TailorSelection, id: string, key: string) => (sel.hidden[id] ?? []).includes(key);

export function setInclude(sel: TailorSelection, id: string, include: boolean): TailorSelection {
    return { ...sel, include: { ...sel.include, [id]: include } };
}

export function setHidden(sel: TailorSelection, id: string, key: string, hide: boolean): TailorSelection {
    const list = sel.hidden[id] ?? [];
    if (list.includes(key) === hide) return sel;
    return { ...sel, hidden: { ...sel.hidden, [id]: hide ? [...list, key] : list.filter(k => k !== key) } };
}

// ---------- suggestions

export type SuggestionSource = "ai" | "trim";

export type TailorSuggestion =
    | { id: string; kind: "item"; itemId: string; include: boolean; reason: string; source: SuggestionSource }
    | { id: string; kind: "sub"; itemId: string; key: string; hide: boolean; reason: string; source: SuggestionSource };

export const itemSuggestionId = (itemId: string) => `item:${itemId}`;
export const subSuggestionId = (itemId: string, key: string) => `sub:${itemId}:${key}`;

export interface TrimResult {
    /** Item ids switched off and item id -> keys hidden by trimming. */
    items: string[];
    keys: Record<string, string[]>;
}

export const TRIM_ITEM_REASON = "Removed to fit one page (least relevant remaining item).";
export const TRIM_KEY_REASON = "Hidden to fit one page.";

/**
 * Everything where `target` (the plan, possibly trimmed) differs from `base`
 * (the selection the window opened with), with a reason for each.
 */
export function diffSuggestions(plan: TailorPlan, target: TailorSelection, base: TailorSelection, trim: TrimResult = { items: [], keys: {} }): TailorSuggestion[] {
    const out: TailorSuggestion[] = [];
    const trimmedItems = new Set(trim.items);
    for (const d of plan.items) {
        const on = target.include[d.id] ?? false;
        if (on !== (base.include[d.id] ?? false)) {
            const trimmed = trimmedItems.has(d.id);
            out.push({ id: itemSuggestionId(d.id), kind: "item", itemId: d.id, include: on, reason: trimmed ? TRIM_ITEM_REASON : d.reason, source: trimmed ? "trim" : "ai" });
        }
        if (!on) continue;
        const want = new Set(target.hidden[d.id] ?? []);
        const have = new Set(base.hidden[d.id] ?? []);
        const trimmedKeys = new Set(trim.keys[d.id] ?? []);
        for (const key of want) {
            if (have.has(key)) continue;
            const trimmed = trimmedKeys.has(key);
            out.push({ id: subSuggestionId(d.id, key), kind: "sub", itemId: d.id, key, hide: true, source: trimmed ? "trim" : "ai", reason: trimmed ? TRIM_KEY_REASON : plan.hiddenReasons[d.id]?.[key] ?? "Not relevant to this job." });
        }
        for (const key of have) {
            if (want.has(key)) continue;
            const names = plan.protectedBy[d.id]?.[key];
            out.push({ id: subSuggestionId(d.id, key), kind: "sub", itemId: d.id, key, hide: false, source: "ai", reason: names ? `Names ${join(names)}, a keyword ATS scans for.` : "Worth showing for this job." });
        }
    }
    return out;
}

/** True while the selection does not yet match the suggestion. */
export function isPending(s: TailorSuggestion, sel: TailorSelection): boolean {
    return s.kind === "item" ? (sel.include[s.itemId] ?? false) !== s.include : isHidden(sel, s.itemId, s.key) !== s.hide;
}

export function acceptSuggestion(sel: TailorSelection, s: TailorSuggestion): TailorSelection {
    return s.kind === "item" ? setInclude(sel, s.itemId, s.include) : setHidden(sel, s.itemId, s.key, s.hide);
}

// ---------- trimming

/** Content to remove, least valuable first, while the selection is over one page. */
export function trimSteps(plan: TailorPlan, sel: TailorSelection, resume: ResumeData): TrimStep[] {
    const itemById = new Map<string, AnyItem>();
    for (const key of RESUME_LIST_KEYS) for (const it of resume[key] as AnyItem[]) itemById.set(it.id, it);
    const value = (d: TailorDecision) => d.soft.length;
    const byValue = (a: TailorDecision, b: TailorDecision) => value(a) - value(b) || (a.recency < b.recency ? -1 : a.recency > b.recency ? 1 : 0);
    const visibleBullets = (d: TailorDecision) => {
        const item = itemById.get(d.id);
        if (!BULLET_SECTIONS.has(d.section) || !item) return [];
        const off = new Set(sel.hidden[d.id] ?? []);
        const prot = new Set(plan.protectedKeys[d.id] ?? []);
        // Keep at least the first bullet of every item; drop from the end.
        return subEntriesOf(d.section, item).filter(e => !off.has(e.key)).slice(1).filter(e => !prot.has(e.key)).reverse();
    };

    const on = plan.items.filter(d => sel.include[d.id] && itemById.has(d.id));
    const unlocked = on.filter(d => !d.locked && d.section !== "skills").sort(byValue);
    const locked = on.filter(d => d.locked).sort(byValue);
    const steps: TrimStep[] = [];
    for (const d of unlocked) for (const e of visibleBullets(d)) steps.push({ kind: "bullet", id: d.id, key: e.key });
    for (const d of unlocked) steps.push({ kind: "item", id: d.id });
    for (const d of locked) for (const e of visibleBullets(d)) steps.push({ kind: "bullet", id: d.id, key: e.key });
    return steps;
}

/** Selection with one trim step applied. */
export function applyTrim(sel: TailorSelection, step: TrimStep): TailorSelection {
    return step.kind === "item" ? setInclude(sel, step.id, false) : setHidden(sel, step.id, step.key, true);
}

/** Safety cap on recompiles while trimming. */
export const MAX_TRIM_STEPS = 80;

/**
 * Trims `sel` until `pagesOf` reports one page (or the steps run out).
 * `pagesOf` compiles in the browser; the loop is shared by the automatic trim
 * suggestions and the "Fit to one page" button.
 */
export async function fitToOnePage(plan: TailorPlan, sel: TailorSelection, resume: ResumeData, pagesOf: (sel: TailorSelection) => Promise<number>): Promise<{ selection: TailorSelection; trim: TrimResult; pages: number }> {
    let current = sel;
    let pages = await pagesOf(current);
    const steps = trimSteps(plan, sel, resume);
    const trim: TrimResult = { items: [], keys: {} };
    for (let i = 0; pages > 1 && i < Math.min(steps.length, MAX_TRIM_STEPS); i++) {
        const step = steps[i];
        // A bullet of an item that an earlier step already removed changes nothing.
        if (step.kind === "bullet" && !current.include[step.id]) continue;
        current = applyTrim(current, step);
        if (step.kind === "item") trim.items.push(step.id);
        else (trim.keys[step.id] ??= []).push(step.key);
        pages = await pagesOf(current);
    }
    return { selection: current, trim, pages };
}

// ---------- override warnings

export interface OverrideWarnings {
    /** item id -> why it should stay on. */
    items: Record<string, string>;
    /** item id -> key -> why it should stay shown. */
    keys: Record<string, Record<string, string>>;
}

/** Yellow warnings for locked items switched off and protected lines hidden. */
export function overrideWarnings(plan: TailorPlan, sel: TailorSelection, resume: ResumeData, requirements: Requirement[]): OverrideWarnings {
    const out: OverrideWarnings = { items: {}, keys: {} };
    const applied = applySelection(resume, sel);
    const coverage = requirementCoverage(requirements, coverageItems(applied, true));
    const educationOn = plan.items.some(d => d.section === "education" && sel.include[d.id]);

    for (const d of plan.items) {
        const on = sel.include[d.id] ?? false;
        if (!on && d.locked) {
            if (d.hardKeys.length > 0) {
                const uncovered = d.hardKeys.filter(k => (coverage.get(k)?.items.length ?? 0) === 0);
                const names = uncovered.map(k => requirements.find(r => r.name === k)?.display ?? k);
                out.items[d.id] = uncovered.length > 0
                    ? `Nothing else included covers ${join(names)}. Without it the résumé misses ${uncovered.length > 1 ? "hard requirements" : "a hard requirement"}, and ATS filters often reject that.`
                    : `Covers ${join(d.hard)}. Other included items still cover ${d.hard.length > 1 ? "them" : "it"}, but this is direct evidence for a hard requirement.`;
            } else if (d.section === "education" && !educationOn) {
                out.items[d.id] = "A résumé without an education entry is often filtered out.";
            }
        }
        if (!on) continue;
        for (const [key, names] of Object.entries(plan.protectedBy[d.id] ?? {})) {
            if (isHidden(sel, d.id, key)) (out.keys[d.id] ??= {})[key] = `Names ${join(names)}. Hiding it removes a keyword ATS scans for.`;
        }
    }
    return out;
}
