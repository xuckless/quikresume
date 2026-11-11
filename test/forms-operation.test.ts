import { describe, expect, it } from "vitest";
import { formsTransition, type FormsOperation } from "../src/lib/ui/forms-operation";
import { formsPreviewTransition } from "../src/lib/ui/forms-preview";

describe("form operations", () => {
    it("supports failure, retry, progress and success with state-specific payloads", () => {
        let state: FormsOperation<string, string> = { status: "idle" };
        state = formsTransition(state, { type: "start", id: 1, operation: "upload" });
        state = formsTransition(state, { type: "fail", id: 1, error: "offline" });
        expect(state).toEqual({ status: "failed", error: "offline" });
        state = formsTransition(state, { type: "start", id: 2, operation: "upload" });
        state = formsTransition(state, { type: "progress", id: 2, operation: "reading" });
        expect(state).toEqual({ status: "running", id: 2, operation: "reading" });
        expect(formsTransition(state, { type: "succeed", id: 2, result: "saved" })).toEqual({ status: "succeeded", result: "saved" });
    });
    it("ignores stale success, failure and progress after cancellation or retry", () => {
        const running: FormsOperation<string> = { status: "running", id: 2, operation: "save" };
        for (const event of [{ type: "succeed", id: 1, result: undefined }, { type: "fail", id: 1, error: "late" }, { type: "progress", id: 1, operation: "late" }] as const) {
            expect(formsTransition(running, event)).toBe(running);
            expect(formsTransition(formsTransition(running, { type: "reset" }), event)).toEqual({ status: "idle" });
        }
    });
    it("retains the last preview through compile failure and engine retry", () => {
        const image = { svg: "<svg/>", pageCount: 2 };
        const compiling = formsPreviewTransition({ status: "ready", image }, { type: "compile" });
        const failed = formsPreviewTransition(compiling, { type: "fail", error: "engine", engine: true });
        expect(failed).toEqual({ status: "engine-failed", previous: image, error: "engine" });
        expect(formsPreviewTransition(failed, { type: "load" })).toEqual({ status: "loading-engine", previous: image });
        expect(formsPreviewTransition(failed, { type: "render", image })).toEqual({ status: "ready", image });
    });
});
