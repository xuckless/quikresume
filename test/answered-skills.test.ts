import { describe, expect, it } from "vitest";
import { emptyResumeData, type SkillCategory } from "@/types/schema";
import { withAnsweredSkills } from "@/lib/match/answered-skills";
import { scoreJob } from "@/lib/match/score";
import type { Requirement } from "@/lib/match/types";

const category = (overrides: Partial<SkillCategory> = {}): SkillCategory => ({
    id: "s1", category: "Cloud & DevOps", items: "Docker, Terraform", hidden: [], isSelected: true, tags: [], tagsHash: null, ...overrides,
});

const prometheus: Requirement = {
    name: "prometheus", display: "Prometheus", kind: "tool-platform", importance: "must", yearsMin: null, satisfiedBy: [], evidence: [], reason: "", semantic: [],
};

describe("withAnsweredSkills", () => {
    it("appends new skills once, by skill key", () => {
        expect(withAnsweredSkills(category(), ["Prometheus", "docker", "prometheus"]).items).toBe("Docker, Terraform, Prometheus");
    });

    it("switches the category on and shows the answered skills", () => {
        const off = category({ isSelected: false, items: "Docker, Prometheus", hidden: ["prometheus", "docker"] });
        const next = withAnsweredSkills(off, ["Prometheus"]);
        expect(next.isSelected).toBe(true);
        expect(next.hidden).toEqual(["docker"]);
    });

    it("makes a Yes count for the working selection (regression: answered skill left in a switched-off category)", () => {
        const tagged = (c: SkillCategory) => ({ ...c, tags: [{ name: "prometheus", display: "Prometheus", kind: "tool-platform" as const }] });
        const score = (c: SkillCategory) => scoreJob([prometheus], { ...emptyResumeData(), skills: [c] }).rows[0].strength;
        const off = category({ isSelected: false });
        expect(score(tagged({ ...off, items: `${off.items}, Prometheus` }))).toBe(0);
        expect(score(tagged(withAnsweredSkills(off, ["Prometheus"])))).toBeGreaterThan(0.9);
    });
});
