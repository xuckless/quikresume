import { describe, expect, it } from "vitest";
import { emptyResumeData, type ResumeData, type WorkExperience } from "@/types/schema";
import { closeWordingHit } from "@/lib/match/text";
import { scoreJob } from "@/lib/match/score";
import type { Requirement } from "@/lib/match/types";

describe("closeWordingHit", () => {
    it("finds a multi-word requirement in close wording on one line", () => {
        expect(closeWordingHit("Wrote REST APIs with Django for internal dashboards", "REST API Design")).toBe(true);
        expect(closeWordingHit("Backend engineer with 5 years", "Backend Development")).toBe(true);
        expect(closeWordingHit("Owned on-call and incident response for checkout APIs", "On-Call and Incident Response")).toBe(true);
    });
    it("needs every core word on the same line", () => {
        expect(closeWordingHit("Built REST endpoints\nDesigned an API gateway", "REST API Design")).toBe(false);
    });
    it("never matches single-word names, short or broad lone words", () => {
        expect(closeWordingHit("Used Java daily", "Java")).toBe(false);
        expect(closeWordingHit("Let's go build it", "Go Development")).toBe(false);
        expect(closeWordingHit("Charted in Epic software", "Software Engineering")).toBe(false);
    });
    it("does not match a different word that shares a prefix", () => {
        expect(closeWordingHit("Built JavaScript frontends", "Java Development")).toBe(false);
    });
});

describe("scoreJob close-wording floor", () => {
    const NOW = new Date(2026, 10, 1);
    const work: WorkExperience = {
        id: "w1", title: "Software Engineer", company: "Contoso", startDate: "2022-01-01", endDate: "Present",
        description: "Wrote REST APIs with Django", hidden: [], isSelected: true, tags: [], tagsHash: null,
    };
    const data: ResumeData = { ...emptyResumeData(), workExperience: [work] };
    const req = (name: string, kind: Requirement["kind"] = "technical-skill"): Requirement =>
        ({ name: name.toLowerCase(), display: name, kind, importance: "must", yearsMin: null, satisfiedBy: [], evidence: [], reason: "", semantic: [] });

    it("counts close wording as keyword evidence without ATS placement", () => {
        const row = scoreJob([req("REST API Design")], data, {}, { now: NOW }).rows[0];
        expect(row.strength).toBe(0.5);
        expect(row.evidence[0].via).toBe("keyword");
        expect(row.placement).toBe(0);
    });
    it("leaves credentials to exact or confirmed evidence", () => {
        const row = scoreJob([req("REST API Certificate", "credential")], data, {}, { now: NOW }).rows[0];
        expect(row.strength).toBe(0);
    });
});
