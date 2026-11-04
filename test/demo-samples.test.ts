import { describe, expect, it } from "vitest";
import { demoSamples } from "@/lib/demo/samples";
import { scoreJob } from "@/lib/match/score";
import { toTypstDoc } from "@/lib/typst/doc";

describe("demo samples", () => {
    it("score in a believable range and print", () => {
        for (const s of demoSamples()) {
            const m = scoreJob(s.job.requirements, s.resume, {}, { now: new Date(2026, 10, 1) });
            expect(m.score, s.id).toBeGreaterThan(40);
            expect(m.score, s.id).toBeLessThan(97);
            expect(toTypstDoc(s.resume).experience.length).toBeGreaterThan(0);
            console.log(s.id, m.score, `must ${m.must.hit}/${m.must.total}`, m.gated ? "gated" : "");
        }
    });
});
