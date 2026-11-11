// Editor save / leave / discard and coach re-review workflows as explicit
// state machines. Single flight is guaranteed by the phase: while "saving"
// (or "running") only the operation's own outcome is accepted.

export type EditorWorkflow =
    | { phase: "editing"; error: string | null }
    | { phase: "confirm-discard" }
    | { phase: "confirm-leave"; target: string }
    | { phase: "confirm-variants"; names: string[]; target: string | null }
    | { phase: "saving"; target: string | null };

export type EditorEvent =
    | { type: "dismissed" }
    | { type: "discard-requested" }
    | { type: "leave-requested"; target: string }
    | { type: "variants-affected"; names: string[]; target: string | null }
    | { type: "error-raised"; error: string }
    | { type: "save-started"; target: string | null }
    | { type: "save-succeeded" }
    | { type: "save-failed"; error: string };

export const initialEditorWorkflow: EditorWorkflow = { phase: "editing", error: null };

export function editorTransition(state: EditorWorkflow, event: EditorEvent): EditorWorkflow {
    if (state.phase === "saving") {
        if (event.type === "save-succeeded") return initialEditorWorkflow;
        if (event.type === "save-failed") return { phase: "editing", error: event.error };
        return state;
    }
    switch (event.type) {
        case "dismissed": return initialEditorWorkflow;
        case "discard-requested": return { phase: "confirm-discard" };
        case "leave-requested": return { phase: "confirm-leave", target: event.target };
        case "variants-affected": return { phase: "confirm-variants", names: event.names, target: event.target };
        case "error-raised": return { phase: "editing", error: event.error };
        case "save-started": return { phase: "saving", target: event.target };
        default: return state;
    }
}

export type ReReviewWorkflow = { phase: "idle" | "confirming" | "running" };

export type ReReviewEvent =
    | { type: "requested" }
    | { type: "cancelled" }
    | { type: "started" }
    | { type: "finished" };

export const initialReReviewWorkflow: ReReviewWorkflow = { phase: "idle" };

export function reReviewTransition(state: ReReviewWorkflow, event: ReReviewEvent): ReReviewWorkflow {
    if (state.phase === "running") return event.type === "finished" ? initialReReviewWorkflow : state;
    switch (event.type) {
        case "requested": return { phase: "confirming" };
        case "cancelled": return initialReReviewWorkflow;
        case "started": return state.phase === "confirming" ? { phase: "running" } : state;
        default: return state;
    }
}
