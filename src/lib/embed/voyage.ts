// src/lib/embed/voyage.ts
// Server-only Voyage AI client (embeddings + rerank) over plain fetch, like lib/glm/client.ts.
//
// - embed(): voyage-4-lite at 512 dims (Matryoshka), batched. `query` for job requirements, `document`
//   for résumé text: Voyage prepends a different retrieval prompt for each.
// - rerank(): rerank-3-lite, one query against up to ~16 short documents.
// Usage is recorded in the caller's AI budget (withAiUser context). A 429 is retried once after
// Retry-After when that fits `maxWaitMs`; otherwise VoyageError(429) is thrown so callers can degrade
// (the free tier without a payment method allows 3 requests / 10K tokens per minute).

import "server-only";
import { aiContext, recordAiUsage } from "@/lib/security/ai-budget";

const BASE = "https://api.voyageai.com/v1";
export const EMBED_MODEL = process.env.VOYAGE_EMBED_MODEL || "voyage-4-lite";
export const RERANK_MODEL = process.env.VOYAGE_RERANK_MODEL || "rerank-3-lite";
export const EMBED_DIMS = 512;
/** Cache key part: vectors from another model or size are never mixed. */
export const VECTOR_SPACE = `${EMBED_MODEL}@${EMBED_DIMS}`;

const MAX_BATCH = 128;
/** Rough per-request token cap so one call stays inside the free tier's 10K tokens/min. */
const MAX_BATCH_TOKENS = 8_000;

export class VoyageError extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
        this.name = "VoyageError";
    }
}

export const isVoyageConfigured = () => Boolean(process.env.VOYAGE_API_KEY);

const estimateTokens = (s: string) => Math.ceil(s.length / 3.5);

async function post<T>(path: string, body: unknown, opts: { maxWaitMs?: number; timeoutMs?: number } = {}): Promise<T> {
    const key = process.env.VOYAGE_API_KEY;
    if (!key) throw new VoyageError("Embeddings are not configured (VOYAGE_API_KEY missing).", 500);
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${BASE}${path}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
        });
        if (res.ok) return (await res.json()) as T;
        const text = await res.text().catch(() => "");
        if (res.status === 429 && attempt === 0) {
            const retryAfter = Number(res.headers.get("retry-after"));
            const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 21_000;
            if (waitMs <= (opts.maxWaitMs ?? 0)) {
                await new Promise(r => setTimeout(r, waitMs));
                continue;
            }
        }
        throw new VoyageError(`Voyage ${path} failed (${res.status}): ${text.slice(0, 200)}`, res.status);
    }
}

async function record(tokens: number, model: string) {
    const ctx = aiContext();
    if (ctx) await recordAiUsage(ctx, tokens, model);
}

/** Unit-length Float32 vectors, one per input, in order. */
export async function embed(texts: string[], inputType: "query" | "document", opts: { maxWaitMs?: number } = {}): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    let i = 0;
    while (i < texts.length) {
        const batch: string[] = [];
        let tokens = 0;
        while (i < texts.length && batch.length < MAX_BATCH) {
            const t = texts[i].slice(0, 4000) || " ";
            const est = estimateTokens(t);
            if (batch.length > 0 && tokens + est > MAX_BATCH_TOKENS) break;
            batch.push(t);
            tokens += est;
            i++;
        }
        const json = await post<{ data: { embedding: number[]; index: number }[]; usage?: { total_tokens?: number } }>(
            "/embeddings",
            { input: batch, model: EMBED_MODEL, input_type: inputType, output_dimension: EMBED_DIMS },
            { maxWaitMs: opts.maxWaitMs },
        );
        await record(json.usage?.total_tokens ?? tokens, EMBED_MODEL);
        const rows = [...json.data].sort((a, b) => a.index - b.index);
        for (const r of rows) out.push(normalize(Float32Array.from(r.embedding)));
    }
    return out;
}

/** Relevance score per document (same order as `documents`), 0..1. */
export async function rerank(query: string, documents: string[], opts: { maxWaitMs?: number } = {}): Promise<number[]> {
    if (documents.length === 0) return [];
    const json = await post<{ data: { index: number; relevance_score: number }[]; usage?: { total_tokens?: number } }>(
        "/rerank",
        { query: query.slice(0, 1000), documents: documents.map(d => d.slice(0, 2000)), model: RERANK_MODEL, truncation: true },
        { maxWaitMs: opts.maxWaitMs },
    );
    await record(json.usage?.total_tokens ?? estimateTokens(query + documents.join(" ")), RERANK_MODEL);
    const scores = new Array<number>(documents.length).fill(0);
    for (const r of json.data) scores[r.index] = r.relevance_score;
    return scores;
}

function normalize(v: Float32Array): Float32Array {
    let n = 0;
    for (let k = 0; k < v.length; k++) n += v[k] * v[k];
    n = Math.sqrt(n) || 1;
    for (let k = 0; k < v.length; k++) v[k] /= n;
    return v;
}

// ---------- storage encoding (Firestore): Float32 as base64, ~2.7 KB per 512-dim vector

export function encodeVec(v: Float32Array): string {
    return Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64");
}

export function decodeVec(s: string): Float32Array | null {
    try {
        const buf = Buffer.from(s, "base64");
        if (buf.byteLength !== EMBED_DIMS * 4) return null;
        return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    } catch {
        return null;
    }
}
