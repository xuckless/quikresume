// src/lib/match/tailor-flow.ts
// Pure state of the Tailor window (tailor-dialog.tsx): questions -> review, where each review owns one
// background AI run. Runs are numbered; anything a run reports after a newer review opened, or after
// it already settled, is dropped here, so the dialog needs no guards of its own.

import type { ResumeData } from "@/types/schema";
import type { Requirement } from "./types";
import type { TailorPlan, TailorSuggestion } from "./auto-tailor";

export type TailorAi =
    | { status: "running" }
    | { status: "done"; untrimmed: TailorSuggestion[]; trimmed: TailorSuggestion[] }
    | { status: "failed"; message: string };

export type TailorFlow =
    | { step: "questions"; run: 0 }
    | {
        step: "review";
        run: number;
        /** Library the review works on (questions answered Yes changed it). */
        library: ResumeData;
        plan: TailorPlan;
        requirements: Requirement[];
        ai: TailorAi;
        warning: string | null;
    };

export type TailorFlowEvent =
    /** Opens the review for run `run` (must be newer than the current one) with the tag-based plan. */
    | { type: "review"; run: number; library: ResumeData; plan: TailorPlan; requirements: Requirement[]; warning: string | null }
    /** The AI plan arrived; suggestions follow once it is fitted to a page. */
    | { type: "reviewed"; run: number; plan: TailorPlan; requirements: Requirement[]; warning: string | null }
    | { type: "settle"; run: number; ai: Exclude<TailorAi, { status: "running" }>; warning: string | null }
    | { type: "dismissWarning" };

export const TAILOR_QUESTIONS: TailorFlow = { step: "questions", run: 0 };

export function tailorFlowTransition(state: TailorFlow, event: TailorFlowEvent): TailorFlow {
    if (event.type === "review") {
        if (event.run <= state.run) return state;
        const { run, library, plan, requirements, warning } = event;
        return { step: "review", run, library, plan, requirements, ai: { status: "running" }, warning };
    }
    if (state.step !== "review") return state;
    if (event.type === "dismissWarning") return state.warning === null ? state : { ...state, warning: null };
    if (event.run !== state.run || state.ai.status !== "running") return state;
    if (event.type === "reviewed") {
        return { ...state, plan: event.plan, requirements: event.requirements, warning: event.warning ?? state.warning };
    }
    return { ...state, ai: event.ai, warning: event.warning ?? state.warning };
}
