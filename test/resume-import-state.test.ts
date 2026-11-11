import { describe, expect, it } from "vitest";
import { importTransition, initialImportState } from "../src/lib/ui/resume-import-state";
import { emptyResumeData } from "../src/types/schema";
const file = { name: "resume.pdf", size: 100 } as File;
describe("resume import transitions", () => {
    it("guards empty runs and deduplicates files", () => {
        expect(importTransition(initialImportState, { type: "start", run: 1 })).toBe(initialImportState);
        const picked = importTransition(initialImportState, { type: "add", files: [file, file] });
        expect(picked.step !== "review" && picked.queue.length).toBe(1);
    });
    it("retains per-file failures, resets them on retry and rejects stale results", () => {
        const picked = importTransition(initialImportState, { type: "add", files: [file] });
        const running = importTransition(picked, { type: "start", run: 1 });
        const failed = importTransition(running, { type: "failed", run: 1, index: 0, error: "offline" });
        const retry = importTransition(importTransition(failed, { type: "complete", run: 1, parsed: [] }), { type: "start", run: 2 });
        expect(retry.step !== "review" && retry.queue[0].status).toBe("queued");
        expect(importTransition(retry, { type: "complete", run: 1, parsed: [] })).toBe(retry);
    });
    it("uses the same review for LinkedIn and file results", () => {
        const parsed = { fileName: "LinkedIn", data: emptyResumeData(), warnings: [] };
        const linkedin = importTransition(initialImportState, { type: "linkedin", file: parsed });
        const running = importTransition(importTransition(initialImportState, { type: "add", files: [file] }), { type: "start", run: 1 });
        expect(importTransition(running, { type: "complete", run: 1, parsed: [parsed] })).toEqual(linkedin);
    });
});
