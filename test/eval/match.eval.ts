// test/eval/match.eval.ts: match-quality evaluation (npm run eval:match). Calls GLM and Voyage for real.
//
// For every hand-labelled case in match-cases.json: tag the résumé (same tagger as a save), score on tags
// alone, then run the full enrichment (semantic evidence + LLM judge + O*NET, lib/match/reconcile.ts
// enrichRequirements with an in-memory vector store) and score again. A requirement is predicted
// "covered" when its strength m ≥ 0.5. Reports precision / recall / F1 per stage and per tier, the
// observed hit rate per strength band (a calibration check: m 0.85+ should almost always be right), and
// every error. EVAL_RUNS=2 repeats the full stage to measure score stability; EVAL_EFFORT sets the
// judge's effort (default low; the app runs it at max in the background).
// Results are written to test/eval/.results/ (gitignored).

import { it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { emptyResumeData, type ResumeData } from "@/types/schema";
import { makeTag } from "@/lib/tags/normalize";
import type { TagKind } from "@/lib/tags/types";
import type { Requirement } from "@/lib/match/types";
import { allInputs, applyTags, tagContext } from "@/lib/tags/content";
import { extractTags } from "@/lib/tags/extract";
import { enrichRequirements } from "@/lib/match/reconcile";
import { memoryVecStore } from "@/lib/match/evidence";
import { requirementTier, scoreJob } from "@/lib/match/score";
import type { Effort } from "@/lib/glm/effort";

interface Case {
    id: string;
    title: string;
    resume: {
        headline: string;
        work?: { title: string; company: string; start: string; end: string; bullets: string[] }[];
        education?: { degree: string; institution: string; start: string; end: string }[];
        skills?: { category: string; items: string[] }[];
        certs?: { name: string; issuer: string; year: string }[];
    };
    requirements: { name: string; kind: TagKind; importance: "must" | "nice"; covered: boolean }[];
}

const DIR = path.join(__dirname);
const cases: Case[] = JSON.parse(fs.readFileSync(path.join(DIR, "match-cases.json"), "utf8")).cases;
const RUNS = Math.max(1, Number(process.env.EVAL_RUNS ?? 1));
const EFFORT = (process.env.EVAL_EFFORT ?? "low") as Effort;
const ONLY = process.env.EVAL_CASES?.split(",").filter(Boolean);
const COVERED = 0.5;
const month = (s: string) => (s === "Present" ? "Present" : `${s}-01`);

function toResume(c: Case): ResumeData {
    const d = emptyResumeData();
    const base = { isSelected: true, tags: [], tagsHash: null };
    d.personalInfo = { ...d.personalInfo, firstName: "Alex", lastName: "Candidate", headline: c.resume.headline };
    d.workExperience = (c.resume.work ?? []).map((w, i) => ({ ...base, id: `w${i}`, title: w.title, company: w.company, startDate: month(w.start), endDate: month(w.end), description: w.bullets.join("\n"), hidden: [] }));
    d.education = (c.resume.education ?? []).map((e, i) => ({ ...base, id: `e${i}`, degree: e.degree, institution: e.institution, startDate: month(e.start), endDate: month(e.end), gpa: "", minor: "", details: "" }));
    d.skills = (c.resume.skills ?? []).map((s, i) => ({ ...base, id: `s${i}`, category: s.category, items: s.items.join(", "), hidden: [] }));
    d.certifications = (c.resume.certs ?? []).map((x, i) => ({ ...base, id: `c${i}`, name: x.name, issuer: x.issuer, year: x.year, credentialId: "", expires: "" }));
    return d;
}

const toRequirements = (c: Case): Requirement[] =>
    c.requirements.map(r => ({ ...makeTag(r.name, r.kind)!, importance: r.importance, yearsMin: null, satisfiedBy: [], evidence: [], reason: "", semantic: [] }));

interface Pred { case: string; requirement: string; tier: string; gold: boolean; m: number; why: string }
const NOW = new Date();

function predictions(c: Case, reqs: Requirement[], resume: ResumeData): Pred[] {
    const m = scoreJob(reqs, resume, {}, { now: NOW });
    const byName = new Map(m.rows.map(r => [r.requirement.name, r]));
    return reqs.map((r, i) => {
        const row = byName.get(r.name);
        const why = (row?.evidence ?? []).slice(0, 2).map(e => `${e.via} ${e.e.toFixed(2)} ${e.label}${e.quote ? ` "${e.quote.slice(0, 60)}"` : ""}`).join("; ")
            + (r.reason ? ` | judge: ${r.reason.slice(0, 100)}` : "") + (row?.via.length ? ` | via tags: ${row.via.join(", ")}` : "");
        return { case: c.id, requirement: r.display, tier: requirementTier(r), gold: c.requirements[i].covered, m: row?.strength ?? 0, why };
    });
}

function metrics(ps: Pred[]) {
    const tp = ps.filter(p => p.gold && p.m >= COVERED).length;
    const fp = ps.filter(p => !p.gold && p.m >= COVERED).length;
    const fn = ps.filter(p => p.gold && p.m < COVERED).length;
    const precision = tp + fp ? tp / (tp + fp) : 1;
    const recall = tp + fn ? tp / (tp + fn) : 1;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    return { n: ps.length, tp, fp, fn, precision: +precision.toFixed(3), recall: +recall.toFixed(3), f1: +f1.toFixed(3) };
}

const BANDS: [number, number][] = [[0, 0.3], [0.3, 0.5], [0.5, 0.85], [0.85, 1.01]];
const bands = (ps: Pred[]) => BANDS.map(([lo, hi]) => {
    const inBand = ps.filter(p => p.m >= lo && p.m < hi);
    return { band: `${lo}-${Math.min(hi, 1)}`, n: inBand.length, goldCovered: inBand.length ? +(inBand.filter(p => p.gold).length / inBand.length).toFixed(2) : null };
});

it("match eval", async () => {
    const tagsOnly: Pred[] = [];
    const full: Pred[] = [];
    const stability: { case: string; scores: number[] }[] = [];
    const warnings: string[] = [];
    for (const c of cases.filter(x => !ONLY || ONLY.includes(x.id))) {
        const t0 = Date.now();
        let resume = toResume(c);
        const tagged = await extractTags(allInputs(resume), {}, { budgetMs: 90_000, context: tagContext(resume) });
        resume = applyTags(resume, tagged.tagsById);
        const reqs = toRequirements(c);
        tagsOnly.push(...predictions(c, reqs, resume));

        const scores: number[] = [];
        for (let run = 0; run < RUNS; run++) {
            const r = await enrichRequirements("eval", { title: c.title, requirements: reqs }, resume, {}, null, 240_000, { store: memoryVecStore(), effort: EFFORT });
            if (r.warning) warnings.push(`${c.id}: judge: ${r.warning}`);
            if (r.semanticWarning) warnings.push(`${c.id}: semantic: ${r.semanticWarning}`);
            if (run === 0) full.push(...predictions(c, r.requirements, resume));
            scores.push(scoreJob(r.requirements, resume, {}, { now: NOW, titleSim: r.titleSim }).score);
        }
        stability.push({ case: c.id, scores });
        console.log(`${c.id.padEnd(24)} ${((Date.now() - t0) / 1000).toFixed(0)}s  scores ${scores.join(" / ")}`);
    }

    const errors = full.filter(p => p.gold !== p.m >= COVERED).map(p => `${p.gold ? "MISSED" : "FALSE+"} ${p.case} · ${p.requirement} (${p.tier}) m=${p.m.toFixed(2)}\n      ${p.why}`);
    const report = {
        at: new Date().toISOString(), effort: EFFORT, runs: RUNS, cases: stability.length,
        tagsOnly: { all: metrics(tagsOnly), hard: metrics(tagsOnly.filter(p => p.tier === "hard")), soft: metrics(tagsOnly.filter(p => p.tier === "soft")) },
        full: { all: metrics(full), hard: metrics(full.filter(p => p.tier === "hard")), soft: metrics(full.filter(p => p.tier === "soft")), bands: bands(full) },
        stability: RUNS > 1 ? { meanAbsDelta: +(stability.reduce((s, x) => s + Math.abs(x.scores[1] - x.scores[0]), 0) / stability.length).toFixed(2), byCase: stability } : null,
        errors, warnings,
    };
    fs.mkdirSync(path.join(DIR, ".results"), { recursive: true });
    const out = path.join(DIR, ".results", `match-${report.at.replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.log("\ntags only:", JSON.stringify(report.tagsOnly.all), "\nfull:     ", JSON.stringify(report.full.all));
    console.log("hard:     ", JSON.stringify(report.full.hard), "\nsoft:     ", JSON.stringify(report.full.soft));
    console.log("bands:    ", JSON.stringify(report.full.bands));
    if (report.stability) console.log("stability: mean |Δscore| between runs =", report.stability.meanAbsDelta);
    console.log(`\n${errors.length} errors:\n${errors.join("\n")}`);
    if (warnings.length) console.log(`\nwarnings:\n${warnings.join("\n")}`);
    console.log(`\nreport: ${out}`);
}, 3_600_000);
