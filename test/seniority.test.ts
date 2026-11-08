import { describe, expect, it } from "vitest";
import { candidateLevel, contradictsMeasuredLevel, seniorityFit, titleLevel, workYears } from "@/lib/match/seniority";
import { emptyResumeData, type WorkExperience } from "@/types/schema";
import { scoreJob } from "@/lib/match/score";
import { demoSamples } from "@/lib/demo/samples";

const NOW = new Date(2026, 10, 1);
const job = (id: string, title: string, startDate: string, endDate: string, isSelected = true): WorkExperience =>
    ({ id, title, company: "Co", startDate, endDate, description: "", hidden: [], isSelected, tags: [], tagsHash: null });

describe("seniority", () => {
    it("reads levels from titles", () => {
        expect(titleLevel("Senior Software Engineer")).toBe("senior");
        expect(titleLevel("Charge Nurse")).toBe("lead");
        expect(titleLevel("Director of Nursing")).toBe("executive");
        expect(titleLevel("Software Engineering Intern")).toBe("intern");
        expect(titleLevel("Principal Engineer")).toBe("lead");
        expect(titleLevel("Software Engineer I")).toBe("entry");
        expect(titleLevel("Registered Nurse")).toBeNull();
        expect(titleLevel("Assistant Professor")).toBeNull();
    });
    it("counts years of selected non-internship work, overlaps merged", () => {
        const d = emptyResumeData();
        d.workExperience = [
            job("a", "Engineer", "2020-01-01", "2023-12-01"),
            job("b", "Contractor", "2022-01-01", "2024-12-01"),
            job("c", "Intern", "2018-05-01", "2018-08-01"),
            job("d", "Barista", "2010-01-01", "2019-12-01", false),
        ];
        expect(workYears(d, NOW)).toBe(5);
        expect(candidateLevel(d, NOW).level).toBe("senior");
    });
    it("a title lifts the level, years never lower it", () => {
        const d = emptyResumeData();
        d.workExperience = [job("a", "Team Lead", "2023-01-01", "Present")];
        expect(candidateLevel(d, NOW)).toMatchObject({ level: "lead", fromTitle: "Team Lead" });
        d.workExperience = [job("a", "Junior Developer", "2016-01-01", "Present")];
        expect(candidateLevel(d, NOW).level).toBe("senior");
    });
    it("under-qualified costs more than over-qualified", () => {
        expect(seniorityFit("senior", "senior")).toBe(1);
        expect(seniorityFit("senior", "mid")).toBeLessThan(seniorityFit("mid", "senior"));
        expect(seniorityFit("executive", "entry")).toBe(0.25);
    });
    it("enters the title sub-score and is reported", () => {
        const s = demoSamples()[0];
        const m = scoreJob(s.job.requirements, s.resume, {}, { now: NOW, seniority: "executive" });
        expect(m.seniority?.job).toBe("executive");
        expect(m.subScores.title).toBeLessThan(0.5);
        expect(scoreJob(s.job.requirements, s.resume, {}, { now: NOW }).seniority).toBeNull();
    });
});


describe("contradictsMeasuredLevel", () => {
    const note = "Posting targets a senior engineer with 5+ years; candidate is mid-level with 5 years.";
    it("drops a seniority note when the measured level meets the posting", () => {
        expect(contradictsMeasuredLevel(note, "senior", "senior")).toBe(true);
        expect(contradictsMeasuredLevel(note, "mid", "lead")).toBe(true);
    });
    it("keeps it when the measured level is below the posting, or unknown", () => {
        expect(contradictsMeasuredLevel(note, "senior", "mid")).toBe(false);
        expect(contradictsMeasuredLevel(note, null, "senior")).toBe(false);
        expect(contradictsMeasuredLevel(note, "senior", null)).toBe(false);
    });
    it("keeps notes about other conflicts", () => {
        expect(contradictsMeasuredLevel("The posting is on-site in Austin; you want remote work in Seattle.", "senior", "senior")).toBe(false);
    });
});
