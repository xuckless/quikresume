/** Pure state machine behind `ResumePreview`: engine start-up, compiles, and the last good render. */
export interface PreviewImage { svg: string; pageCount: number }

export type PreviewState =
    | { status: "loading-engine" | "compiling"; previous: PreviewImage | null }
    | { status: "ready"; image: PreviewImage }
    | { status: "error" | "engine-failed"; error: string; previous: PreviewImage | null };

export type PreviewEvent =
    | { type: "load" | "compile" }
    | { type: "render"; image: PreviewImage }
    | { type: "fail"; error: string; engine: boolean };

export const INITIAL_PREVIEW: PreviewState = { status: "loading-engine", previous: null };

/** The last good render stays visible (dimmed) through compiles and errors. */
export const previewImage = (state: PreviewState): PreviewImage | null =>
    state.status === "ready" ? state.image : state.previous;

export function previewTransition(state: PreviewState, event: PreviewEvent): PreviewState {
    const previous = previewImage(state);
    switch (event.type) {
        // A recompile only re-arms the engine loader after it failed (Retry); otherwise the state is untouched.
        case "load": return state.status === "engine-failed" ? { status: "loading-engine", previous } : state;
        case "compile": return { status: "compiling", previous };
        case "render": return { status: "ready", image: event.image };
        case "fail": return { status: event.engine ? "engine-failed" : "error", error: event.error, previous };
    }
}
