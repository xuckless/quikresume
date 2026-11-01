// src/lib/match/evidence.ts
// Server-only: semantic evidence for a job's requirements over the candidate's whole library.
//
//   1. Library units (lib/match/units.ts) are embedded once per item content (Voyage, "document"),
//      cached in users/{uid}/vecs/{itemId} keyed by content hash + vector space.
//   2. Requirements are embedded as queries; the job title too (title similarity).
//   3. requirement × unit cosine; candidates per requirement ranked by hubness-corrected similarity.
//   4. Uncertain requirements (best cosine-only p in the middle band) get the reranker, within a
//      call budget; a 429 stops reranking for the rest of the run instead of waiting.
//   5. Per requirement: the best unit of each item, calibrated p (lib/match/semantic.ts), top 5 kept.
// Also maps category requirements to the candidate's products of that category (lib/match/taxonomy.ts).
// Returns hints for the LLM reconcile pass (only uncertain pairs need a judge) and never throws:
// any failure returns `{ warning }` and the job keeps working on tags alone.

import "server-only";
import type { ResumeData } from "@/types/schema";
import { userCol } from "@/lib/db/user-collection";
import { decodeVec, embed, encodeVec, isVoyageConfigured, rerank, VECTOR_SPACE, VoyageError } from "@/lib/embed/voyage";
import { kindMeta } from "@/lib/tags/types";
import { libraryUnits, type MatchUnit } from "@/lib/match/units";
import { cslsMatrix, dot, probability, requirementQuery, rerankQuery } from "@/lib/match/semantic";
import type { Requirement, SemanticHit } from "@/lib/match/types";
import { aggregateTags } from "@/lib/tags/aggregate";
import { requirementCategories, taxonomySatisfiers, type TaxonomyMatch } from "@/lib/match/taxonomy";

const CANDIDATES = 8;
const KEEP = 5;
const MIN_P = 0.15;
/** Cosine-only p band in which the reranker is worth a call. */
const RERANK_BAND: [number, number] = [0.15, 0.9];
const MAX_RERANK_CALLS = Number(process.env.VOYAGE_MAX_RERANK_CALLS ?? 30);

export interface SemanticResult {
    /** requirement name -> hits (best unit per item), p desc. */
    byRequirement: Map<string, SemanticHit[]>;
    /** work-experience item id -> calibrated title similarity. */
    titleSim: Record<string, number>;
    /** requirement name -> candidate tags that are products of the category it names (O*NET). */
    taxonomy: Map<string, TaxonomyMatch>;
    reranked: number;
    warning?: string;
}

interface VecDoc { space: string; hash: string; units: { k: string; v: string }[] }
const HEAD = "\u0000head";
const unitKey = (u: MatchUnit) => u.bulletKey ?? HEAD;

/** Unit vectors for the whole library, embedding only items whose content (or the model) changed. */
async function libraryVectors(uid: string, library: ResumeData): Promise<{ units: MatchUnit[]; vecs: Float32Array[] }> {
    const items = libraryUnits(library).filter(i => i.units.length > 0);
    const col = userCol(uid, "vecs");
    const snaps = items.length ? await col.firestore.getAll(...items.map(i => col.doc(i.id))) : [];
    const cached = new Map<string, Map<string, Float32Array>>();
    snaps.forEach((s, idx) => {
        const d = s.data() as VecDoc | undefined;
        const item = items[idx];
        if (!d || d.space !== VECTOR_SPACE || d.hash !== item.hash) return;
        const m = new Map<string, Float32Array>();
        for (const { k, v } of d.units ?? []) { const vec = decodeVec(v); if (vec) m.set(k, vec); }
        if (item.units.every(u => m.has(unitKey(u)))) cached.set(item.id, m);
    });

    const stale = items.filter(i => !cached.has(i.id));
    if (stale.length) {
        const texts = stale.flatMap(i => i.units.map(u => u.text));
        const vecs = await embed(texts, "document", { maxWaitMs: 25_000 });
        let k = 0;
        const batch = col.firestore.batch();
        for (const item of stale) {
            const m = new Map<string, Float32Array>();
            for (const u of item.units) m.set(unitKey(u), vecs[k++]);
            cached.set(item.id, m);
            batch.set(col.doc(item.id), { space: VECTOR_SPACE, hash: item.hash, units: [...m].map(([key, v]) => ({ k: key, v: encodeVec(v) })) } satisfies VecDoc);
        }
        await batch.commit();
    }

    const units: MatchUnit[] = [];
    const vecs: Float32Array[] = [];
    for (const item of items) {
        const m = cached.get(item.id)!;
        for (const u of item.units) { units.push(u); vecs.push(m.get(unitKey(u))!); }
    }
    return { units, vecs };
}

export async function semanticEvidence(uid: string, requirements: Requirement[], library: ResumeData, jobTitle: string): Promise<SemanticResult> {
    const empty: SemanticResult = { byRequirement: new Map(), titleSim: {}, taxonomy: new Map(), reranked: 0 };
    if (!isVoyageConfigured()) return { ...empty, warning: "Semantic matching is off (VOYAGE_API_KEY missing)." };
    if (requirements.length === 0) return empty;
    try {
        const { units, vecs } = await libraryVectors(uid, library);
        if (units.length === 0) return empty;
        const queries = requirements.map(r => requirementQuery(r.display, kindMeta(r.kind).label));
        const title = jobTitle.trim();
        const qv = await embed(title ? [...queries, `Job title: ${title}`] : queries, "query", { maxWaitMs: 25_000 });

        const cos = requirements.map((_, i) => vecs.map(v => dot(qv[i], v)));
        const csls = cslsMatrix(cos);

        const byRequirement = new Map<string, SemanticHit[]>();
        let rerankCalls = 0;
        let rerankBlocked = false;
        for (let i = 0; i < requirements.length; i++) {
            const r = requirements[i];
            const order = cos[i].map((_, j) => j).sort((a, b) => csls[i][b] - csls[i][a]);
            // Best unit per item among the top candidates.
            const picked: number[] = [];
            const seenItems = new Set<string>();
            for (const j of order) {
                if (seenItems.has(units[j].itemId)) continue;
                seenItems.add(units[j].itemId);
                picked.push(j);
                if (picked.length >= CANDIDATES) break;
            }
            const pCos = picked.map(j => probability(cos[i][j], null));
            let rr: number[] | null = null;
            const best = Math.max(...pCos);
            if (!rerankBlocked && rerankCalls < MAX_RERANK_CALLS && best >= RERANK_BAND[0] && best <= RERANK_BAND[1]) {
                try {
                    rr = await rerank(rerankQuery(r.display, kindMeta(r.kind).label), picked.map(j => units[j].text));
                    rerankCalls++;
                } catch (err) {
                    if (err instanceof VoyageError && err.status === 429) rerankBlocked = true;
                    else console.error("[evidence] rerank failed:", err instanceof Error ? err.message : err);
                }
            }
            const hits: SemanticHit[] = picked
                .map((j, k) => ({
                    itemId: units[j].itemId,
                    bullet: units[j].bulletKey,
                    p: rr ? probability(cos[i][j], rr[k]) : pCos[k],
                    quote: units[j].quote.slice(0, 200),
                    reranked: rr !== null,
                    confirmed: null,
                }))
                .filter(h => h.p >= MIN_P)
                .sort((a, b) => b.p - a.p)
                .slice(0, KEEP)
                .map(h => ({ ...h, p: Math.round(h.p * 1000) / 1000 }));
            byRequirement.set(r.name, hits);
        }

        // Category requirements ("EHR software") satisfied by named products the candidate has ("Epic").
        const inventory = aggregateTags(library, { selectedOnly: false }).map(t => ({ name: t.name, display: t.display }));
        const taxonomy = new Map<string, TaxonomyMatch>();
        requirements.forEach((r, i) => {
            const m = taxonomySatisfiers(requirementCategories(r.display, qv[i]), inventory.filter(t => t.name !== r.name));
            if (m) taxonomy.set(r.name, m);
        });

        const titleSim: Record<string, number> = {};
        if (title) {
            const tq = qv[requirements.length];
            units.forEach((u, j) => {
                if (u.section !== "workExperience" || u.bulletKey !== null) return;
                titleSim[u.itemId] = Math.round(probability(dot(tq, vecs[j]), null) * 1000) / 1000;
            });
        }
        return {
            byRequirement, titleSim, taxonomy, reranked: rerankCalls,
            warning: rerankBlocked ? "Some matches were scored without the reranker (embedding provider rate limit)." : undefined,
        };
    } catch (err) {
        console.error("[evidence] semantic pass failed:", err instanceof Error ? err.message : err);
        const warning = err instanceof VoyageError && err.status === 429
            ? "Semantic matching is rate-limited right now; scores use skill tags only. Try Re-check in a minute."
            : "Semantic matching failed; scores use skill tags only.";
        return { ...empty, warning };
    }
}

/** Candidate items per requirement for the LLM judge: only the uncertain ones need a verdict. */
export function reconcileHints(requirements: Requirement[], sem: SemanticResult): Record<string, { id: string; p: number }[]> {
    const out: Record<string, { id: string; p: number }[]> = {};
    for (const r of requirements) {
        const hits = (sem.byRequirement.get(r.name) ?? []).filter(h => h.p >= 0.25 && h.p < 0.9).slice(0, 4);
        if (hits.length) out[r.display] = hits.map(h => ({ id: h.itemId, p: h.p }));
    }
    return out;
}
