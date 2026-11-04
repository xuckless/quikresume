import { describe, expect, it } from "vitest";
import { emptyResumeData, type WorkExperience } from "@/types/schema";
import { recommendSelection } from "@/lib/match/recommend";
import { DEFAULT_CAPS, type Requirement } from "@/lib/match/types";
import { makeTag } from "@/lib/tags/normalize";
import { demoSamples } from "@/lib/demo/samples";

const NOW = new Date(2026, 10, 1);
const req = (name: string, importance: "must" | "nice"): Requirement =>
    ({ ...makeTag(name, "technical-skill")!, importance, yearsMin: null, satisfiedBy: [], evidence: [], reason: "", semantic: [] });
const role = (id: string, start: string, tags: string[]): WorkExperience => ({
    id, title: `Role ${id}`, company: "Co", startDate: start, endDate: "Present", description: "", hidden: [], isSelected: false,
    tags: tags.map(t => makeTag(t, "technical-skill")!), tagsHash: null,
});

describe("recommendSelection", () => {
    it("prefers a new requirement over a second carrier of a strong one", () => {
        const d = emptyResumeData();
        d.workExperience = [role("a", "2024-01-01", ["Go"]), role("b", "2024-02-01", ["Go"]), role("c", "2023-01-01", ["Terraform"])];
        const r = recommendSelection([req("Go", "must"), req("Terraform", "nice")], d, { ...DEFAULT_CAPS, workExperience: 2 }, { now: NOW });
        // One Go carrier (they tie: both current) plus the Terraform role, not both Go roles.
        expect(r.chosen.size).toBe(2);
        expect(r.chosen.has("c")).toBe(true);
        expect(r.uncovered).toEqual([]);
    });
    it("does not spend slots on items that add nothing", () => {
        const d = emptyResumeData();
        d.workExperience = [role("a", "2024-01-01", ["Go"]), role("x", "2024-01-01", ["Baking"])];
        const r = recommendSelection([req("Go", "must")], d, DEFAULT_CAPS, { now: NOW });
        expect([...r.chosen]).toEqual(["a"]);
    });
    it("old roles still count as covering (recency ranks, it doesn't erase)", () => {
        const d = emptyResumeData();
        d.workExperience = [{ ...role("old", "2012-01-01", ["COBOL"]), endDate: "2014-01-01" }];
        const r = recommendSelection([req("COBOL", "must")], d, DEFAULT_CAPS, { now: NOW });
        expect(r.covered.has("cobol")).toBe(true);
    });
    it("keeps the demo libraries' picks sensible", () => {
        for (const s of demoSamples()) {
            const r = recommendSelection(s.job.requirements, s.resume, DEFAULT_CAPS, { now: NOW });
            expect(r.chosen.size, s.id).toBeGreaterThan(2);
            expect(r.covered.size, s.id).toBeGreaterThan(s.job.requirements.length / 2);
        }
    });
});
