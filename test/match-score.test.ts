import { describe, expect, it } from "vitest";
import { emptyResumeData, type ResumeData, type WorkExperience } from "@/types/schema";
import { scoreJob, MUST_GATE_CAP } from "@/lib/match/score";
import { noisyOr, recencyWeight, cslsMatrix, probability } from "@/lib/match/semantic";
import type { Requirement, SemanticHit } from "@/lib/match/types";
import { bulletKey } from "@/lib/sub-items";

const NOW = new Date(2026, 10, 1);

function job(overrides: Partial<WorkExperience> = {}): WorkExperience {
    return {
        id: "w1", title: "Software Engineer", company: "Contoso", startDate: "2022-01-01", endDate: "Present",
        description: "Migrated 40 services to Kubernetes\nCollaborated with cross-functional teams", hidden: [], isSelected: true,
        tags: [], tagsHash: null, ...overrides,
    };
}

function req(name: string, overrides: Partial<Requirement> = {}): Requirement {
    return { name, display: name, kind: "tool-platform", importance: "must", yearsMin: null, satisfiedBy: [], evidence: [], reason: "", semantic: [], ...overrides };
}

const hit = (overrides: Partial<SemanticHit> = {}): SemanticHit =>
    ({ itemId: "w1", bullet: bulletKey("Migrated 40 services to Kubernetes"), p: 0.9, quote: "Migrated 40 services to Kubernetes", reranked: true, confirmed: null, ...overrides });

const data = (items: WorkExperience[]): ResumeData => ({ ...emptyResumeData(), workExperience: items });

describe("semantic maths", () => {
    it("noisy-OR has diminishing returns and stays ≤ 1", () => {
        expect(noisyOr([])).toBe(0);
        expect(noisyOr([0.5])).toBeCloseTo(0.5);
        expect(noisyOr([0.5, 0.5])).toBeCloseTo(0.75);
        expect(noisyOr([1, 1, 1])).toBe(1);
    });
    it("recency halves every 4 years and treats current work as 1", () => {
        expect(recencyWeight(0)).toBe(1);
        expect(recencyWeight(48)).toBeCloseTo(0.5);
    });
    it("calibration is monotonic in cosine", () => {
        expect(probability(0.7, null)).toBeGreaterThan(probability(0.4, null));
    });
    it("CSLS penalises a unit close to every requirement", () => {
        const cos = [[0.8, 0.6], [0.2, 0.6], [0.2, 0.6]];
        const c = cslsMatrix(cos, 2);
        // unit 1 (generic) loses to unit 0 for requirement 0 by more than the raw gap
        expect(c[0][0] - c[0][1]).toBeGreaterThan(cos[0][0] - cos[0][1]);
    });
});

describe("scoreJob v2", () => {
    it("counts a semantic hit on a selected, visible bullet", () => {
        const m = scoreJob([req("kubernetes", { display: "Kubernetes", semantic: [hit()] })], data([job()]), {}, { now: NOW });
        expect(m.rows[0].strength).toBeGreaterThan(0.85);
        expect(m.rows[0].evidence[0].via).toBe("semantic");
    });
    it("drops evidence from a hidden bullet or an unselected item", () => {
        const hidden = job({ hidden: [bulletKey("Migrated 40 services to Kubernetes")] });
        expect(scoreJob([req("kubernetes", { semantic: [hit()] })], data([hidden]), {}, { now: NOW }).rows[0].evidence).toHaveLength(0);
        const off = job({ isSelected: false });
        expect(scoreJob([req("kubernetes", { semantic: [hit()] })], data([off]), {}, { now: NOW }).rows[0].evidence).toHaveLength(0);
    });
    it("down-weights hits the AI judge saw and rejected, boosts confirmed ones", () => {
        const rejected = scoreJob([req("k", { semantic: [hit({ p: 0.6, confirmed: false })] })], data([job()]), {}, { now: NOW }).rows[0].strength;
        const confirmed = scoreJob([req("k", { semantic: [hit({ p: 0.6, confirmed: true })] })], data([job()]), {}, { now: NOW }).rows[0].strength;
        expect(rejected).toBeCloseTo(0.24);
        expect(confirmed).toBeCloseTo(0.9);
    });
    it("caps the score when a hard must-have is missing", () => {
        const reqs = [req("kubernetes", { semantic: [hit({ p: 1 })] }), req("terraform"), ...["a", "b", "c", "d", "e", "f"].map(n => req(n, { semantic: [hit({ p: 1 })], importance: "nice" }))];
        const m = scoreJob(reqs, data([job()]), {}, { now: NOW });
        expect(m.missingMust.map(r => r.name)).toEqual(["terraform"]);
        expect(m.score).toBeLessThanOrEqual(MUST_GATE_CAP);
    });
    it("what-if gain equals the score change of fully covering the requirement (no gate, coverage only)", () => {
        const base = [req("x", { importance: "nice", kind: "soft-skill" }), req("y", { importance: "nice", kind: "soft-skill", semantic: [hit({ p: 1 })] })];
        const before = scoreJob(base, data([job()]), {}, { now: NOW });
        const gainX = before.rows.find(r => r.requirement.name === "x")!.gain;
        const after = scoreJob([{ ...base[0], semantic: [hit({ p: 1 })] }, base[1]], data([job()]), {}, { now: NOW });
        expect(after.score - before.score).toBeCloseTo(gainX, 0);
    });
    it("measures years of evidenced experience against yearsMin", () => {
        const m = scoreJob([req("k", { yearsMin: 5, semantic: [hit({ p: 0.95 })] })], data([job({ startDate: "2023-11-01" })]), {}, { now: NOW });
        expect(m.rows[0].years).toEqual({ have: 3.1, need: 5 });
        expect(m.subScores.years).toBeCloseTo(3.1 / 5, 2);
    });
});

import { builtinSatisfiers, canonicalKey as canonicalTagName } from "@/lib/tags/normalize";

describe("aliases and satisfiers beyond software", () => {
    it("no longer maps ambiguous short forms", () => {
        expect(canonicalTagName("cv")).toBe("cv");
        expect(canonicalTagName("cs")).toBe("cs");
        expect(canonicalTagName("BSN")).toBe("bachelor of science in nursing");
        expect(canonicalTagName("RN licence")).toBe("registered nurse");
    });
    it("degree and licence ladders", () => {
        expect(builtinSatisfiers("bachelor's degree", ["bachelor of science in nursing", "juris doctor", "cpr"])).toEqual(["bachelor of science in nursing", "juris doctor"]);
        expect(builtinSatisfiers("registered nurse", ["nurse practitioner", "licensed practical nurse"])).toEqual(["nurse practitioner"]);
        expect(builtinSatisfiers("journeyman electrician", ["master electrician"])).toEqual(["master electrician"]);
    });
});
