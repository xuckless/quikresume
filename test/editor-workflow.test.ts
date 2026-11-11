import { expect, it } from "vitest";
import { editorTransition as reduce, initialEditorWorkflow, initialReReviewWorkflow, reReviewTransition, type EditorEvent } from "@/lib/ui/editor-workflow";
it("keeps editor confirmations exclusive and accepts only the outcome while saving", () => {
    const leaving = reduce(initialEditorWorkflow, { type: "leave-requested", target: "/dashboard/profile" });
    expect(leaving).toEqual({ phase: "confirm-leave", target: "/dashboard/profile" });
    const confirmation = reduce(leaving, { type: "variants-affected", names: ["Work"], target: "/dashboard/profile" });
    expect(confirmation.phase).toBe("confirm-variants");
    const saving = reduce(confirmation, { type: "save-started", target: "/dashboard/profile" });
    expect(saving).toEqual({ phase: "saving", target: "/dashboard/profile" });
    for (const event of [
        { type: "discard-requested" },
        { type: "leave-requested", target: "/x" },
        { type: "variants-affected", names: [], target: null },
        { type: "error-raised", error: "x" },
        { type: "save-started", target: null },
        { type: "dismissed" },
    ] as EditorEvent[]) expect(reduce(saving, event)).toBe(saving);
    expect(reduce(saving, { type: "save-succeeded" })).toEqual({ phase: "editing", error: null });
});
it("returns to editing with the error after a failed save, and clears it on dismiss", () => {
    const saving = reduce(initialEditorWorkflow, { type: "save-started", target: null });
    const failed = reduce(saving, { type: "save-failed", error: "offline" });
    expect(failed).toEqual({ phase: "editing", error: "offline" });
    expect(reduce(failed, { type: "save-started", target: null }).phase).toBe("saving");
    expect(reduce(failed, { type: "dismissed" })).toEqual({ phase: "editing", error: null });
});
it("runs a re-review only after confirmation and ignores everything but its end", () => {
    expect(reReviewTransition(initialReReviewWorkflow, { type: "started" })).toBe(initialReReviewWorkflow);
    const confirming = reReviewTransition(initialReReviewWorkflow, { type: "requested" });
    expect(reReviewTransition(confirming, { type: "cancelled" })).toEqual({ phase: "idle" });
    const running = reReviewTransition(confirming, { type: "started" });
    expect(running).toEqual({ phase: "running" });
    expect(reReviewTransition(running, { type: "requested" })).toBe(running);
    expect(reReviewTransition(running, { type: "cancelled" })).toBe(running);
    expect(reReviewTransition(running, { type: "finished" })).toEqual({ phase: "idle" });
});
