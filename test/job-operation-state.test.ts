import { describe, expect, it } from "vitest";
import { jobOperationTransition } from "../src/lib/ui/job-operation-state";
import { deleteTransition } from "../src/lib/ui/job-delete-state";
import type { JobRecord } from "../src/lib/match/types";
describe("job operation transitions", () => {
    it("can show input validation errors before starting an operation", () => {
        expect(jobOperationTransition({ status: "idle" }, { type: "invalid", message: "File too large" })).toEqual({ status: "failed", message: "File too large" });
    });
    it("keeps failures after finally completion, and clears them on retry", () => {
        const running = jobOperationTransition({ status: "idle" }, { type: "start", operation: "save" });
        const failed = jobOperationTransition(running, { type: "fail", message: "offline" });
        expect(jobOperationTransition(failed, { type: "complete" })).toEqual(failed);
        expect(jobOperationTransition(failed, { type: "start", operation: "save" })).toEqual(running);
    });
    it("blocks cancellation during deletion and supports retry", () => {
        const job = { id: "job" } as JobRecord;
        const running = deleteTransition({ status: "confirm", job }, { type: "start" });
        expect(deleteTransition(running, { type: "cancel" })).toEqual(running);
        const failed = deleteTransition(running, { type: "fail", message: "offline" });
        expect(deleteTransition(failed, { type: "start" })).toEqual(running);
        expect(deleteTransition(running, { type: "complete" })).toEqual({ status: "closed" });
    });
});

import { tailorReviewTransition } from "../src/lib/ui/job-tailor-state";
import { jobDetailDialogTransition } from "../src/lib/ui/job-detail-state";
describe("tailor review lifecycle", () => {
    it("rejects stale and repeated AI completion and accepts a newer review", () => {
        const questions = { step: "questions" } as const;
        const running = tailorReviewTransition(questions, { type: "review", run: 1 });
        const newer = tailorReviewTransition(running, { type: "review", run: 2 });
        const done = { status: "done", untrimmed: [], trimmed: [] } as const;
        const result = { status: "done" as const, untrimmed: [...done.untrimmed], trimmed: [...done.trimmed] };
        expect(tailorReviewTransition(newer, { type: "settle", run: 1, ai: result })).toBe(newer);
        const completed = tailorReviewTransition(newer, { type: "settle", run: 2, ai: result });
        expect(completed).toEqual({ step: "review", run: 2, ai: result });
        expect(tailorReviewTransition(completed, { type: "settle", run: 2, ai: { status: "failed", message: "late" } })).toBe(completed);
        expect(tailorReviewTransition(questions, { type: "settle", run: 2, ai: result })).toBe(questions);
    });
    it("only opens one detail dialog at a time", () => {
        expect(jobDetailDialogTransition("tailor", "answers")).toBe("tailor");
        expect(jobDetailDialogTransition("tailor", "closed")).toBe("closed");
        expect(jobDetailDialogTransition("closed", "answers")).toBe("answers");
    });
    it("ignores failure without an active operation and rejects overlapping starts", () => {
        const idle = { status: "idle" } as const;
        expect(jobOperationTransition(idle, { type: "fail", message: "late" })).toBe(idle);
        const reading = jobOperationTransition(idle, { type: "start", operation: "reading" });
        expect(jobOperationTransition(reading, { type: "start", operation: "save" })).toBe(reading);
        expect(jobOperationTransition(reading, { type: "advance", operation: "tagging" })).toEqual({ status: "running", operation: "tagging" });
    });
});
