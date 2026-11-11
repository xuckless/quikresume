import { describe, expect, it } from "vitest";
import { aiFailedWarning, hasContent, mergeAnalysis, needsAnalysis, type CaptureResult } from "./profile-merge";

const job = (title: string) => ({ title, company: "Example", startDate: "2020", endDate: "Present", bullets: [] });
const capture = (over: Partial<CaptureResult> = {}): CaptureResult => ({
    data: { personalInfo: { name: "Jordan Example", headline: "Engineer", summary: "Builds things." }, workExperience: [job("Parsed")], skills: [] },
    warnings: [], unread: [], topCard: true, ...over,
});

describe("needsAnalysis", () => {
    it("is false for a confident parse", () => expect(needsAnalysis(capture())).toBe(false));
    it("is true without a top card, with an unread card, or with nothing but the name", () => {
        expect(needsAnalysis(capture({ topCard: false }))).toBe(true);
        expect(needsAnalysis(capture({ unread: ["skills"] }))).toBe(true);
        expect(needsAnalysis(capture({ data: { personalInfo: { name: "Jordan Example" } } }))).toBe(true);
    });
});

describe("hasContent", () => {
    it("needs a name, a summary or an item", () => {
        expect(hasContent({ personalInfo: {} })).toBe(false);
        expect(hasContent({ personalInfo: { name: " " }, skills: [] })).toBe(false);
        expect(hasContent({ personalInfo: { summary: "Hi" } })).toBe(true);
        expect(hasContent({ languages: [{ language: "French", proficiency: "" }] })).toBe(true);
    });
});

describe("mergeAnalysis", () => {
    const ai = {
        personalInfo: { firstName: "J", lastName: "E", headline: "AI headline", location: "Lakeview", summary: "AI summary" },
        workExperience: [job("AI 1"), job("AI 2")],
        skills: [{ category: "Skills", items: ["Sales"] }],
        education: [],
    };

    it("keeps what the parser read and fills empty sections and blank fields", () => {
        const { data, warnings } = mergeAnalysis(capture(), ai);
        expect(data.workExperience).toEqual([job("Parsed")]);
        expect(data.skills).toEqual(ai.skills);
        expect(data.personalInfo).toEqual({ name: "Jordan Example", headline: "Engineer", summary: "Builds things.", location: "Lakeview" });
        expect(warnings).toEqual(["Read with AI: Skills. Check the details."]);
    });

    it("replaces a section the parser reported unread, and its warning", () => {
        const { data, warnings } = mergeAnalysis(capture({ unread: ["workExperience", "summary"], warnings: ["Could not read Experience.", "Could not read About.", "Projects may be incomplete."] }), ai);
        expect(data.workExperience).toEqual(ai.workExperience);
        expect(data.personalInfo?.summary).toBe("AI summary");
        expect(warnings).toEqual(["Read with AI: About, Experience, Skills. Check the details.", "Projects may be incomplete."]);
    });

    it("takes the name from the AI only when the top card was unreadable", () => {
        const unread = mergeAnalysis(capture({ topCard: false, data: { personalInfo: {} } }), ai);
        expect(unread.data.personalInfo).toMatchObject({ firstName: "J", lastName: "E", headline: "AI headline" });
        expect(unread.warnings[0]).toMatch(/^Read with AI: your name and headline, About, Experience, Skills\./);
    });

    it("adds nothing when the AI found nothing new", () => {
        const c = capture({ unread: ["projects"], warnings: ["Could not read Projects."] });
        expect(mergeAnalysis(c, {})).toEqual({ data: c.data, warnings: ["Could not read Projects."] });
    });
});

it("words an AI failure without a trailing period inside the brackets", () => {
    expect(aiFailedWarning("Timed out.")).toBe("Some parts of your profile could not be read, and reading them with AI failed (Timed out). Check them against LinkedIn.");
});
