import { describe, expect, it } from "vitest";
import { savedAnswerFor } from "@/lib/autofill/prompt";
import { readAutofillPrefs, DECLINE } from "@/lib/autofill/types";

describe("savedAnswerFor", () => {
    const saved = [{ question: "Why do you want to work here?", answer: "Mission." }, { question: "Desired salary", answer: "95,000 CAD" }];
    it("matches the same question with different punctuation / case", () => {
        expect(savedAnswerFor("Why do you want to work here", saved)).toBe("Mission.");
        expect(savedAnswerFor("DESIRED SALARY *", saved)).toBe("95,000 CAD");
    });
    it("does not match a different question", () => {
        expect(savedAnswerFor("Why are you leaving your current job?", saved)).toBeNull();
    });
});

describe("readAutofillPrefs", () => {
    it("clamps, defaults EEO to decline and drops junk", () => {
        const p = readAutofillPrefs({ workAuthorized: "maybe", eeo: { gender: "" }, earliestStart: "next week", salary: { currency: "cad", period: "weird" },
            answers: [{ question: "Q", answer: "" }, { question: "Q2", answer: "A2" }], agentInstructions: "x".repeat(5000) });
        expect(p.workAuthorized).toBe("");
        expect(p.eeo.gender).toBe(DECLINE);
        expect(p.earliestStart).toBe("");
        expect(p.salary).toMatchObject({ currency: "CAD", period: "year" });
        expect(p.answers.map(a => a.question)).toEqual(["Q2"]);
        expect(p.agentInstructions.length).toBe(2000);
    });
});
