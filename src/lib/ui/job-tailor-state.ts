import type { TailorSuggestion } from "../match/auto-tailor";
export type TailorAiState = { status: "running" } | { status: "done"; untrimmed: TailorSuggestion[]; trimmed: TailorSuggestion[] } | { status: "failed"; message: string };
export type TailorReviewState = { step: "questions" } | { step: "review"; run: number; ai: TailorAiState };
export type TailorReviewEvent = { type: "review"; run: number } | { type: "settle"; run: number; ai: Exclude<TailorAiState, { status: "running" }> };
export function tailorReviewTransition(state: TailorReviewState, event: TailorReviewEvent): TailorReviewState {
    if (event.type === "review") {
        if (state.step === "review" && event.run <= state.run) return state;
        return { step: "review", run: event.run, ai: { status: "running" } };
    }
    return state.step === "review" && state.run === event.run && state.ai.status === "running"
        ? { ...state, ai: event.ai } : state;
}
