// src/lib/match/coverage.ts
// Which items cover which requirements. Pure; shared by the scorer, the
// set-cover recommender and the reconcile pass.
//
// An item covers a requirement when it carries the requirement's exact tag
// key, one of the keys in `requirement.satisfiedBy` (LLM reconcile pass) or
// a key the built-in hierarchy accepts (`builtinSatisfiers`), or when the
// reconcile pass cited the item in `requirement.evidence`.

import type { ResumeData, ResumeListKey } from "@/types/schema";
import { RESUME_LIST_KEYS } from "@/types/schema";
import { itemTitle } from "@/lib/sections";
import type { TagCarrier } from "@/lib/tags/aggregate";
import { builtinSatisfiers } from "@/lib/tags/normalize";
import type { Tag } from "@/lib/tags/types";
import type { Requirement } from "@/lib/match/types";

export interface CoverageItem {
    carrier: TagCarrier;
    tags: Tag[];
}

export interface RequirementCoverage {
    requirement: Requirement;
    /** Distinct items covering the requirement, in document order. */
    items: TagCarrier[];
    /** Tag keys (other than the exact key) through which it was covered. */
    via: string[];
    /** Display names for `via`, same order. */
    viaDisplay: string[];
}

/** Every tag-carrying unit of the document (profile + items), optionally only selected items. */
export function coverageItems(data: ResumeData, selectedOnly: boolean): CoverageItem[] {
    const out: CoverageItem[] = [];
    if (data.profileTags.length > 0) {
        out.push({ carrier: { section: "profile", id: "profile", label: "Headline & summary" }, tags: data.profileTags });
    }
    for (const key of RESUME_LIST_KEYS) {
        for (const item of data[key] as ResumeData[ResumeListKey][number][]) {
            if (selectedOnly && !item.isSelected) continue;
            out.push({ carrier: { section: key, id: item.id, label: itemTitle(key, item) }, tags: item.tags });
        }
    }
    return out;
}

/** requirement key -> every tag key that counts for it (exact, reconciled, built-in). */
export function satisfierIndex(requirements: Requirement[], inventory: Iterable<string>): Map<string, Set<string>> {
    const keys = [...inventory];
    const index = new Map<string, Set<string>>();
    for (const r of requirements) {
        const set = new Set<string>([r.name, ...r.satisfiedBy, ...builtinSatisfiers(r.name, keys)]);
        index.set(r.name, set);
    }
    return index;
}

/**
 * A semantic hit strong enough for selection decisions (Tailor, set cover): calibrated p ≥ SEMANTIC_COVERS and
 * not rejected by the AI judge. The scorer itself uses every hit with its own weight (lib/match/score.ts).
 */
export const SEMANTIC_COVERS = 0.6;
const semanticCovers = (r: Requirement, itemId: string) =>
    (r.semantic ?? []).some(h => h.itemId === itemId && h.p >= SEMANTIC_COVERS && h.confirmed !== false);

/** Requirement keys one item covers (by tags, satisfiers, cited evidence or a strong semantic hit). */
export function coveredByItem(item: CoverageItem, requirements: Requirement[], index: Map<string, Set<string>>): Set<string> {
    const names = new Set(item.tags.map(t => t.name));
    const out = new Set<string>();
    for (const r of requirements) {
        const accepted = index.get(r.name);
        if (r.evidence.includes(item.carrier.id) || (accepted && [...accepted].some(k => names.has(k))) || semanticCovers(r, item.carrier.id)) out.add(r.name);
    }
    return out;
}

export function requirementCoverage(requirements: Requirement[], items: CoverageItem[]): Map<string, RequirementCoverage> {
    const inventory = new Set<string>();
    const display = new Map<string, string>();
    for (const it of items) for (const t of it.tags) { inventory.add(t.name); if (!display.has(t.name)) display.set(t.name, t.display); }
    const index = satisfierIndex(requirements, inventory);

    const out = new Map<string, RequirementCoverage>();
    for (const r of requirements) {
        const accepted = index.get(r.name) ?? new Set<string>([r.name]);
        const carriers: TagCarrier[] = [];
        const via = new Set<string>();
        for (const it of items) {
            const names = new Set(it.tags.map(t => t.name));
            let hit = r.evidence.includes(it.carrier.id);
            for (const k of accepted) {
                if (!names.has(k)) continue;
                hit = true;
                if (k !== r.name) via.add(k);
            }
            if (hit) carriers.push(it.carrier);
        }
        const viaKeys = [...via];
        out.set(r.name, { requirement: r, items: carriers, via: viaKeys, viaDisplay: viaKeys.map(k => display.get(k) ?? k) });
    }
    return out;
}
