import { describe, expect, it } from "vitest";
import { previewTransition, type PreviewState } from "../src/lib/typst/preview-state";

describe("preview state", () => {
    const image = { svg: "<svg/>", pageCount: 2 };

    it("retains the last render through compile failure and engine retry", () => {
        const compiling = previewTransition({ status: "ready", image }, { type: "compile" });
        const failed = previewTransition(compiling, { type: "fail", error: "engine", engine: true });
        expect(failed).toEqual({ status: "engine-failed", previous: image, error: "engine" });
        expect(previewTransition(failed, { type: "load" })).toEqual({ status: "loading-engine", previous: image });
        expect(previewTransition(failed, { type: "render", image })).toEqual({ status: "ready", image });
    });

    it("only re-arms the engine loader after an engine failure", () => {
        const ready: PreviewState = { status: "ready", image };
        expect(previewTransition(ready, { type: "load" })).toBe(ready);
    });
});
