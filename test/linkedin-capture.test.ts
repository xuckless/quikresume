import { describe, expect, it } from "vitest";
import { linkedInCaptureToFile } from "@/lib/import/linkedin-capture";
import { parseImportObject } from "@/lib/import/parsed-resume";

const URL_ = "https://www.linkedin.com/in/jane-person";
// What extension/lib/profile-extract.ts builds from a profile page.
const CAPTURE = {
    personalInfo: { name: "Jane Q Person", headline: "Senior Engineer", location: "Toronto, Ontario, Canada", summary: "I build payment systems." },
    workExperience: [
        { title: "Senior Engineer", company: "Example Inc", startDate: "Jan 2021", endDate: "Present", bullets: ["Led the payments rewrite."] },
        { title: "", company: "", startDate: "2019", endDate: "", bullets: [] },
    ],
    education: [{ degree: "BSc, Computer Science", institution: "University of Toronto", startDate: "2011", endDate: "2015", gpa: "3.8", details: "" }],
    skills: [{ category: "Skills", items: ["TypeScript", "PostgreSQL"] }],
    certifications: [{ name: "AWS Certified Developer", issuer: "AWS", year: "Jan 2022", credentialId: "ABC-123", expires: "Jan 2025" }],
    languages: [{ language: "French", proficiency: "Professional working proficiency" }],
    custom: [{ section: "Courses", title: "Distributed Systems", subtitle: "CS 454", startDate: "", endDate: "", bullets: [] }],
};

describe("linkedInCaptureToFile", () => {
    it("validates the capture into the review step's input, like a parsed file", () => {
        const file = linkedInCaptureToFile(URL_, CAPTURE, ["Skills may be incomplete."]);
        expect(file.fileName).toBe("LinkedIn profile");
        const { data } = file;
        expect(data.personalInfo).toMatchObject({ firstName: "Jane", lastName: "Q Person", headline: "Senior Engineer", summary: "I build payment systems.", linkedin: URL_ });
        expect(data.workExperience).toHaveLength(1);
        expect(data.workExperience[0]).toMatchObject({ title: "Senior Engineer", company: "Example Inc", startDate: "2021-01-01", endDate: "Present", description: "Led the payments rewrite." });
        expect(data.workExperience[0].id).toMatch(/^tmp-/);
        expect(data.education[0]).toMatchObject({ institution: "University of Toronto", startDate: "2011-01-01", endDate: "2015-01-01", gpa: "3.8" });
        expect(data.skills[0]).toMatchObject({ category: "Skills", items: "TypeScript, PostgreSQL" });
        expect(data.certifications[0]).toMatchObject({ year: "2022", credentialId: "ABC-123", expires: "2025-01" });
        expect(data.custom[0]).toMatchObject({ section: "Courses", title: "Distributed Systems", subtitle: "CS 454" });
        expect(file.warnings[0]).toBe("Skills may be incomplete.");
        expect(file.warnings.some(w => /work experience #2/.test(w))).toBe(true);
    });

    it("survives junk without throwing", () => {
        const file = linkedInCaptureToFile(URL_, { workExperience: "nope", skills: [{ category: 3 }], personalInfo: null } as unknown as Record<string, unknown>, []);
        expect(file.data.workExperience).toEqual([]);
        expect(file.data.personalInfo.linkedin).toBe(URL_);
    });
});

describe("parseImportObject", () => {
    it("treats a non-object as empty", () => {
        expect(parseImportObject(null).data.workExperience).toEqual([]);
        expect(parseImportObject([1, 2]).warnings).toEqual([]);
    });
});
