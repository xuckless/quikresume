import { describe, expect, it } from "vitest";
import { emptyResumeData } from "@/types/schema";
import { scoreJob } from "@/lib/match/score";
import { makeTag } from "@/lib/tags/normalize";
import type { Requirement, SemanticHit } from "@/lib/match/types";
import type { TagKind } from "@/lib/tags/types";

const lib = () => {
    const d = emptyResumeData();
    d.certifications = [{ id: "c1", name: "Registered Practical Nurse (RPN)", issuer: "CNO", year: "2019", credentialId: "", expires: "", isSelected: true, tags: [], tagsHash: null }];
    d.workExperience = [{ id: "w1", title: "Nurse", company: "LTC", startDate: "2020-01-01", endDate: "Present", description: "Gave medications", hidden: [], isSelected: true, tags: [], tagsHash: null }];
    return d;
};
const req = (name: string, kind: TagKind, hit: Partial<SemanticHit> & { itemId: string; p: number }): Requirement => ({
    ...makeTag(name, kind)!, importance: "must", yearsMin: null, satisfiedBy: [], evidence: [], reason: "",
    semantic: [{ bullet: null, quote: "", reranked: true, confirmed: null, ...hit }],
});
const strength = (r: Requirement) => scoreJob([r], lib()).rows[0].strength;

describe("semantic evidence rules", () => {
    it("a credential needs more than an embedding match", () => {
        expect(strength(req("Registered Nurse", "credential", { itemId: "c1", p: 0.95 }))).toBeLessThanOrEqual(0.6);
        expect(strength(req("Registered Nurse", "credential", { itemId: "c1", p: 0.95, confirmed: true }))).toBe(1);
    });
    it("a judge rejection inside the band is respected, even near its top", () => {
        expect(strength(req("Medication Administration", "technical-skill", { itemId: "w1", p: 0.89, confirmed: false }))).toBeCloseTo(0.356, 2);
    });
    it("old jobs' 'rejected' strong hits (above the band, never shown to the judge) count as unjudged", () => {
        expect(strength(req("Medication Administration", "technical-skill", { itemId: "w1", p: 0.93, confirmed: false }))).toBeCloseTo(0.93, 2);
    });
});
