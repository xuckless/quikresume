import { describe, expect, it } from "vitest";
import { emptyResumeData } from "@/types/schema";
import type { ResumeLayout } from "@/lib/layout/types";
import { isPlaceholderSkillCategory, toTypstDoc } from "@/lib/typst/doc";

const cat = (id: string, category: string, items: string) => ({
    id, category, items, hidden: [], isSelected: true, tags: [], tagsHash: null,
});

const labels = (cats: [string, string][], headings?: ResumeLayout["headings"]) => {
    const d = emptyResumeData();
    d.skills = cats.map(([c, items], i) => cat(`s${i}`, c, items));
    if (headings) d.layout = { ...d.layout, headings };
    return toTypstDoc(d).skills.map(k => k.label);
};

describe("unnamed skills categories print without a label", () => {
    it("placeholder names", () => {
        expect(labels([["Skills", "Python, Go"], ["General", "Git"], ["  skills ", "SQL"], ["", "Bash"]])).toEqual(["", "", "", ""]);
    });
    it("real names are kept (trimmed)", () => {
        expect(labels([["Languages ", "Python"], ["Skills", "Git"], ["Other", "Excel"]])).toEqual(["Languages", "", "Other"]);
    });
    it("a category equal to a renamed heading is redundant", () => {
        expect(labels([["Technical Skills", "Go"], ["Tools", "Git"]], { skills: "Technical Skills" })).toEqual(["", "Tools"]);
        expect(labels([["Technical Skills", "Go"]])).toEqual(["Technical Skills"]);
    });
    it("rule", () => {
        expect(isPlaceholderSkillCategory(null)).toBe(true);
        expect(isPlaceholderSkillCategory("Core Competencies", "core competencies")).toBe(true);
        expect(isPlaceholderSkillCategory("Cloud")).toBe(false);
    });
});
