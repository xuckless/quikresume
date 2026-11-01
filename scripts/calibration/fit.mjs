// scripts/calibration/fit.mjs
// Fits the Platt calibration in src/lib/match/calibration.json from labelled pairs.
//
//   node --env-file=.env.local scripts/calibration/fit.mjs [labels.json ...]
//
// Default input is scripts/calibration/seed.json (hand-labelled, several professions). Extra files in
// the same {groups:[{req, units:[[text, 0|1]]}]} shape (e.g. exported reconcile verdicts) are merged.
// Features per pair: cosine of the Voyage embeddings (query vs document) and the rerank-3-lite score.
// Two logistic fits: p = σ(a·cos + c·rerank + b) and the cosine-only p = σ(a·cos + b).
// Raw features are cached in scripts/calibration/.features.json (gitignored) so refits are free.
// Paced for Voyage's free tier (3 requests/min) when no payment method is on file.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const MODEL = process.env.VOYAGE_EMBED_MODEL || "voyage-4-lite";
const RERANK = process.env.VOYAGE_RERANK_MODEL || "rerank-3-lite";
const DIMS = 512;
const KEY = process.env.VOYAGE_API_KEY;
const CACHE = path.join(ROOT, "scripts/calibration/.features.json");
const OUT = path.join(ROOT, "src/lib/match/calibration.json");
const PACE_MS = Number(process.env.VOYAGE_PACE_MS ?? 21_000);

if (!KEY) { console.error("VOYAGE_API_KEY missing (run with --env-file=.env.local)"); process.exit(1); }

const files = process.argv.slice(2).length ? process.argv.slice(2) : [path.join(ROOT, "scripts/calibration/seed.json")];
const groups = files.flatMap(f => JSON.parse(fs.readFileSync(f, "utf8")).groups);
const pairs = groups.flatMap((g, gi) => g.units.map(([text, label]) => ({ gi, req: g.req, text, label })));
console.log(`${groups.length} requirements, ${pairs.length} pairs`);

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function call(p, body) {
    for (let attempt = 0; attempt < 6; attempt++) {
        const res = await fetch(`https://api.voyageai.com/v1${p}`, { method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (res.ok) return res.json();
        if (res.status === 429) { process.stdout.write("(429, waiting) "); await sleep(PACE_MS * 1.5); continue; }
        throw new Error(`${p} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    throw new Error(`${p}: rate limited too many times`);
}

const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : {};
const cacheKey = `${MODEL}@${DIMS}|${RERANK}`;
const feats = cache[cacheKey] ?? {};
const fkey = (req, text) => `${req}\u0000${text}`;

const missing = pairs.filter(p => !feats[fkey(p.req, p.text)]);
if (missing.length) {
    const reqs = [...new Set(missing.map(p => p.req))];
    const texts = [...new Set(missing.map(p => p.text))];
    console.log(`embedding ${reqs.length} queries + ${texts.length} documents`);
    const q = await call("/embeddings", { input: reqs, model: MODEL, input_type: "query", output_dimension: DIMS });
    await sleep(PACE_MS);
    const d = await call("/embeddings", { input: texts, model: MODEL, input_type: "document", output_dimension: DIMS });
    const qv = new Map(reqs.map((r, i) => [r, q.data.find(x => x.index === i).embedding]));
    const dv = new Map(texts.map((t, i) => [t, d.data.find(x => x.index === i).embedding]));
    const cos = (a, b) => { let s = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return s / Math.sqrt(na * nb); };
    for (const req of reqs) {
        await sleep(PACE_MS);
        const docs = missing.filter(p => p.req === req).map(p => p.text);
        const kind = (/\(([^)]+)\)\s*$/.exec(req) ?? [])[1] ?? "requirement";
        const name = req.replace(/\s*\([^)]*\)\s*$/, "");
        const rr = await call("/rerank", { query: `Does this résumé line show that the candidate has: ${name} (${kind})?`, documents: docs, model: RERANK });
        for (const r of rr.data) feats[fkey(req, docs[r.index])] = { cos: cos(qv.get(req), dv.get(docs[r.index])), rerank: r.relevance_score };
        process.stdout.write(".");
        cache[cacheKey] = feats;
        fs.writeFileSync(CACHE, JSON.stringify(cache));
    }
    console.log();
}

const rows = pairs.map(p => ({ ...feats[fkey(p.req, p.text)], y: p.label }));

// L2-regularised logistic regression by gradient descent (features standardised for conditioning).
function fit(cols) {
    const X = rows.map(r => cols.map(c => r[c]));
    const mu = cols.map((_, j) => X.reduce((s, x) => s + x[j], 0) / X.length);
    const sd = cols.map((_, j) => Math.sqrt(X.reduce((s, x) => s + (x[j] - mu[j]) ** 2, 0) / X.length) || 1);
    const Z = X.map(x => x.map((v, j) => (v - mu[j]) / sd[j]));
    let w = cols.map(() => 0), b = 0;
    const lr = 0.1, l2 = 0.01;
    for (let it = 0; it < 20000; it++) {
        const gw = cols.map(() => 0); let gb = 0;
        Z.forEach((z, i) => {
            const p = 1 / (1 + Math.exp(-(z.reduce((s, v, j) => s + v * w[j], 0) + b)));
            const e = p - rows[i].y;
            z.forEach((v, j) => { gw[j] += e * v; }); gb += e;
        });
        w = w.map((wj, j) => wj - lr * (gw[j] / Z.length + l2 * wj)); b -= lr * gb / Z.length;
    }
    // back to raw feature scale
    const raw = w.map((wj, j) => wj / sd[j]);
    const braw = b - w.reduce((s, wj, j) => s + wj * mu[j] / sd[j], 0);
    const pr = r => 1 / (1 + Math.exp(-(cols.reduce((s, c, j) => s + raw[j] * r[c], 0) + braw)));
    const ll = -rows.reduce((s, r) => s + (r.y ? Math.log(pr(r)) : Math.log(1 - pr(r))), 0) / rows.length;
    const acc = rows.filter(r => (pr(r) >= 0.5) === (r.y === 1)).length / rows.length;
    // AUC
    const pos = rows.filter(r => r.y === 1).map(pr), neg = rows.filter(r => r.y === 0).map(pr);
    let auc = 0; for (const p of pos) for (const n of neg) auc += p > n ? 1 : p === n ? 0.5 : 0; auc /= pos.length * neg.length;
    return { raw, braw, ll, acc, auc };
}

const both = fit(["cos", "rerank"]);
const cosOnly = fit(["cos"]);
const stats = (k, y) => { const v = rows.filter(r => r.y === y).map(r => r[k]).sort((a, b) => a - b); return `${y ? "pos" : "neg"} ${k}: min ${v[0].toFixed(3)} med ${v[v.length >> 1].toFixed(3)} max ${v[v.length - 1].toFixed(3)}`; };
console.log(stats("cos", 1)); console.log(stats("cos", 0)); console.log(stats("rerank", 1)); console.log(stats("rerank", 0));
console.log(`with rerank: logloss ${both.ll.toFixed(3)} acc ${both.acc.toFixed(3)} AUC ${both.auc.toFixed(3)}`);
console.log(`cosine only: logloss ${cosOnly.ll.toFixed(3)} acc ${cosOnly.acc.toFixed(3)} AUC ${cosOnly.auc.toFixed(3)}`);

const out = {
    space: `${MODEL}@${DIMS}|${RERANK}`,
    withRerank: { a: +both.raw[0].toFixed(4), c: +both.raw[1].toFixed(4), b: +both.braw.toFixed(4) },
    cosineOnly: { a: +cosOnly.raw[0].toFixed(4), c: 0, b: +cosOnly.braw.toFixed(4) },
    n: rows.length,
    fittedAt: new Date().toISOString().slice(0, 10),
    metrics: { withRerank: { logloss: +both.ll.toFixed(3), auc: +both.auc.toFixed(3) }, cosineOnly: { logloss: +cosOnly.ll.toFixed(3), auc: +cosOnly.auc.toFixed(3) } },
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
console.log("wrote", path.relative(ROOT, OUT), JSON.stringify(out));
