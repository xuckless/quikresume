import { describe, expect, it } from "vitest";
import { emptyResumeData } from "@/types/schema";
import { toTypstDoc } from "@/lib/typst/doc";
import { readResumeBody } from "@/lib/match/resume-body";
import { parseModelOutput } from "@/lib/import/parsed-resume";

const entry = (id: string, section: string, title: string) => ({
    id, section, title, subtitle: "", startDate: "", endDate: "", description: "", hidden: [], isSelected: true, tags: [], tagsHash: null,
});

describe("custom sections", () => {
    it("group by heading (case-insensitive), skip unselected", () => {
        const d = emptyResumeData();
        d.custom = [entry("a", "Teaching", "TA, CS101"), entry("b", "References", "Dr. Lee"), entry("c", "teaching", "TA, CS201"), { ...entry("d", "Hidden", "x"), isSelected: false }];
        expect(toTypstDoc(d).custom.map(g => [g.heading, g.entries.map(e => e.title)])).toEqual([["Teaching", ["TA, CS101", "TA, CS201"]], ["References", ["Dr. Lee"]]]);
        expect(toTypstDoc(d).layout.order).toContain("custom");
    });
    it("bodies from older clients without `custom` are accepted", () => {
        const { custom: _, ...old } = emptyResumeData();
        expect(readResumeBody(old)?.custom).toEqual([]);
    });
    it("import routes unknown sections to custom", () => {
        const out = parseModelOutput(JSON.stringify({ personalInfo: {}, custom: [{ section: "Clinical Rotations", title: "Pediatrics", subtitle: "SickKids", startDate: "2019", endDate: "2019", bullets: ["Cared for 4 patients"] }] }));
        expect(out.data.custom[0]).toMatchObject({ section: "Clinical Rotations", title: "Pediatrics", description: "Cared for 4 patients" });
    });
});
