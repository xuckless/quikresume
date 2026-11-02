// src/lib/match/taxonomy.ts
// Server-only: O*NET product/tool categories (src/lib/match/taxonomy-onet.json, built by
// scripts/build-taxonomy.mjs; O*NET is CC BY 4.0, attribution in the site footer and CLAUDE.md).
//
// One direction only: a requirement that names a CATEGORY ("EHR software", "CRM", "CAD software",
// "multimeters") is satisfied by a named product of that category on the résumé ("Epic", "Salesforce",
// "AutoCAD", "Fluke 87V"). A requirement that is itself a product ("Kubernetes") is never expanded, and
// two products of the same category are never treated as equivalent (the categories are coarse: Java
// and JavaScript share one). Category detection: cosine of the requirement's query embedding (first
// 256 of its 512 Matryoshka dims) to the category titles ≥ CATEGORY_MIN (probed: categories 0.60–0.75,
// non-categories ≤ 0.53).

import "server-only";
import data from "./taxonomy-onet.json";

const CATEGORY_MIN = 0.6;
const CATEGORY_MARGIN = 0.03;

interface TaxonomyFile {
    source: string;
    dims: number;
    groups: [string, 0 | 1][];
    names: Record<string, number[]>;
    vecs: string;
}

const T = data as unknown as TaxonomyFile;
let vecs: Int8Array | null = null;
const groupVecs = () => (vecs ??= new Int8Array(Buffer.from(T.vecs, "base64")));

export const TAXONOMY_SOURCE = T.source;

/** Same normalisation as the build script. */
export const normName = (s: string) => s.toLowerCase().replace(/[®™]/g, "").replace(/[^a-z0-9+#./ -]+/g, " ").replace(/\s+/g, " ").trim();

/** Category ids for a product / tool name, [] when O*NET doesn't know it. */
export function groupsOfName(name: string): number[] {
    return T.names[normName(name)] ?? [];
}

/** Categories a requirement names (it must not itself be a known product). */
export function requirementCategories(display: string, queryVec: Float32Array): number[] {
    if (groupsOfName(display).length > 0) return [];
    const d = T.dims;
    let n = 0;
    for (let j = 0; j < d; j++) n += queryVec[j] * queryVec[j];
    n = Math.sqrt(n) || 1;
    const v = groupVecs();
    const scored: [number, number][] = [];
    for (let g = 0; g < T.groups.length; g++) {
        let s = 0;
        for (let j = 0; j < d; j++) s += (queryVec[j] / n) * (v[g * d + j] / 127);
        if (s >= CATEGORY_MIN) scored.push([s, g]);
    }
    if (scored.length === 0) return [];
    scored.sort((a, b) => b[0] - a[0]);
    return scored.filter(([s]) => s >= scored[0][0] - CATEGORY_MARGIN).slice(0, 3).map(([, g]) => g);
}

export const categoryTitle = (g: number) => T.groups[g]?.[0] ?? "";

export interface TaxonomyMatch {
    /** Category title shown in the reason ("Medical software"). */
    category: string;
    /** Candidate tag keys that are products of that category. */
    satisfiers: string[];
}

/** Candidate tags (key + display) that are products of the requirement's categories. */
export function taxonomySatisfiers(categories: number[], inventory: { name: string; display: string }[]): TaxonomyMatch | null {
    if (categories.length === 0) return null;
    const wanted = new Set(categories);
    const satisfiers = inventory
        .filter(t => [...groupsOfName(t.display), ...groupsOfName(t.name)].some(g => wanted.has(g)))
        .map(t => t.name);
    return satisfiers.length ? { category: categoryTitle(categories[0]), satisfiers: [...new Set(satisfiers)].slice(0, 8) } : null;
}
