// scripts/build-taxonomy.mjs
// Builds src/lib/match/taxonomy-onet.json from the O*NET database (CC BY 4.0, onetcenter.org).
//
//   node --env-file=.env.local scripts/build-taxonomy.mjs [path/to/db_XX_X_text.zip]
//
// Without a path it downloads O*NET 30.0. Uses two files:
//   Technology Skills.txt  named software ("Epic Systems", "Microsoft Excel") -> commodity group ("Medical software")
//   Tools Used.txt         named tools ("Conduit benders", "Multimeters") -> commodity group
// Output: groups (title + embedding of the title, 256 dims int8) and an index from normalised product
// name (plus the name without its vendor prefix, "Microsoft Excel" -> "excel") to group ids.
// Groups are used one way only: a requirement that IS a category ("EHR software", "CAD software") is
// satisfied by a named product of that category. Products in the same group are NOT treated as related
// (the groups are too coarse: Java and JavaScript share one).

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import os from "node:os";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(ROOT, "src/lib/match/taxonomy-onet.json");
const KEY = process.env.VOYAGE_API_KEY;
const MODEL = process.env.VOYAGE_EMBED_MODEL || "voyage-4-lite";
const DIMS = 512; // embedded at the app's size, stored truncated (Matryoshka) to STORE_DIMS
const STORE_DIMS = 256;
if (!KEY) { console.error("VOYAGE_API_KEY missing (run with --env-file=.env.local)"); process.exit(1); }

let zip = process.argv[2];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "onet-"));
if (!zip) {
    zip = path.join(tmp, "onet.zip");
    console.log("downloading O*NET 30.0 …");
    const res = await fetch("https://www.onetcenter.org/dl_files/database/db_30_0_text.zip");
    if (!res.ok) throw new Error(`download failed ${res.status}`);
    fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
}
execFileSync("unzip", ["-oq", zip, "*/Technology Skills.txt", "*/Tools Used.txt", "-d", tmp]);
const dir = fs.readdirSync(tmp).map(d => path.join(tmp, d)).find(d => fs.statSync(d).isDirectory());
const version = path.basename(dir);

function readTsv(file) {
    const [head, ...lines] = fs.readFileSync(path.join(dir, file), "utf8").split(/\r?\n/).filter(Boolean);
    const cols = head.split("\t");
    return lines.map(l => Object.fromEntries(l.split("\t").map((v, i) => [cols[i], v])));
}

const norm = s => s.toLowerCase().replace(/[®™]/g, "").replace(/[^a-z0-9+#./ -]+/g, " ").replace(/\s+/g, " ").trim();

const groups = []; // {title, kind}
const groupId = new Map();
const index = new Map(); // normalised name -> Set(group ids)
const firstWordCount = new Map();
const rows = [
    ...readTsv("Technology Skills.txt").map(r => ({ ...r, kind: "software" })),
    ...readTsv("Tools Used.txt").map(r => ({ ...r, kind: "tool" })),
];
for (const r of rows) {
    const title = r["Commodity Title"];
    const key = `${r.kind}|${title}`;
    if (!groupId.has(key)) { groupId.set(key, groups.length); groups.push({ title, kind: r.kind }); }
    const fw = norm(r.Example).split(" ")[0];
    firstWordCount.set(fw, (firstWordCount.get(fw) ?? 0) + 1);
}
const add = (name, gid) => { if (name.length < 2) return; if (!index.has(name)) index.set(name, new Set()); index.get(name).add(gid); };
for (const r of rows) {
    const gid = groupId.get(`${r.kind}|${r["Commodity Title"]}`);
    const n = norm(r.Example);
    add(n, gid);
    // Vendor prefix: a first word that starts many product names ("microsoft", "autodesk", "intuit", "cerner").
    const words = n.split(" ");
    if (words.length >= 2 && (firstWordCount.get(words[0]) ?? 0) >= 8) {
        const rest = words.slice(1).join(" ");
        if (rest.length >= 3 && !/^(software|systems?|inc|corporation|products?)$/.test(rest)) add(rest, gid);
    }
}
// Common short names O*NET spells out.
const ALIASES = { epic: "epic systems", "epic emr": "epic systems", cerner: "cerner millennium", excel: "microsoft excel", "ms excel": "microsoft excel", quickbooks: "intuit quickbooks", autocad: "autodesk autocad", salesforce: "salesforce software", sap: "sap software", "google sheets": "google sheets" };
for (const [alias, target] of Object.entries(ALIASES)) for (const gid of index.get(target) ?? []) add(alias, gid);

console.log(`${version}: ${groups.length} groups, ${index.size} names`);

// Embed group titles ("Medical software" -> query-side matching of category requirements).
async function embed(texts) {
    for (let attempt = 0; attempt < 5; attempt++) {
        const res = await fetch("https://api.voyageai.com/v1/embeddings", {
            method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({ input: texts, model: MODEL, input_type: "document", output_dimension: DIMS }),
        });
        if (res.ok) return (await res.json()).data.sort((a, b) => a.index - b.index).map(d => d.embedding);
        if (res.status === 429) { await new Promise(r => setTimeout(r, 20_000)); continue; }
        throw new Error(`embed ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    throw new Error("embed: rate limited");
}
const vecs = [];
const texts = groups.map(g => `${g.title} (${g.kind === "software" ? "software category" : "tool or equipment category"})`);
for (let i = 0; i < texts.length; i += 128) {
    vecs.push(...await embed(texts.slice(i, i + 128)));
    process.stdout.write(".");
}
console.log();

// Truncate to STORE_DIMS, renormalise, quantise to int8.
const q = Buffer.alloc(groups.length * STORE_DIMS);
vecs.forEach((v, gi) => {
    const t = v.slice(0, STORE_DIMS);
    const n = Math.hypot(...t) || 1;
    t.forEach((x, j) => { q.writeInt8(Math.max(-127, Math.min(127, Math.round((x / n) * 127))), gi * STORE_DIMS + j); });
});

const out = {
    source: `O*NET ${version.replace(/^db_|_text$/g, "").replace(/_/g, ".")} (CC BY 4.0, National Center for O*NET Development)`,
    model: `${MODEL}@${DIMS}->${STORE_DIMS}int8`,
    dims: STORE_DIMS,
    groups: groups.map(g => [g.title, g.kind === "software" ? 0 : 1]),
    names: Object.fromEntries([...index].map(([k, v]) => [k, [...v]])),
    vecs: q.toString("base64"),
};
fs.writeFileSync(OUT, JSON.stringify(out));
console.log("wrote", path.relative(ROOT, OUT), (fs.statSync(OUT).size / 1e6).toFixed(2), "MB");
