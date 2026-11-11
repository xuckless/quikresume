export interface PreviewImage { svg: string; pageCount: number }
export type FormsPreview =
    | { status: "loading-engine" | "compiling"; previous: PreviewImage | null }
    | { status: "ready"; image: PreviewImage }
    | { status: "error" | "engine-failed"; error: string; previous: PreviewImage | null };
export type PreviewEvent = { type: "load" | "compile" } | { type: "render"; image: PreviewImage } | { type: "fail"; error: string; engine: boolean };
export function formsPreviewTransition(state: FormsPreview, event: PreviewEvent): FormsPreview {
    const previous = state.status === "ready" ? state.image : state.previous;
    switch (event.type) {
        case "load": return { status: "loading-engine", previous };
        case "compile": return { status: "compiling", previous };
        case "render": return { status: "ready", image: event.image };
        case "fail": return { status: event.engine ? "engine-failed" : "error", error: event.error, previous };
    }
}
