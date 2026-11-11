import { describe, expect, it } from "vitest";
import { TAILOR_QUESTIONS, tailorFlowTransition, type TailorAi, type TailorFlow, type TailorFlowEvent } from "@/lib/match/tailor-flow";
import type { TailorPlan } from "@/lib/match/auto-tailor";
import type { ResumeData } from "@/types/schema";

const plan = (tag: string): TailorPlan => ({ items: [], hidden: { [tag]: [] }, hiddenReasons: {}, protectedKeys: {}, protectedBy: {} });
const library = {} as ResumeData;
const review = (run: number, warning: string | null = null): TailorFlowEvent =>
    ({ type: "review", run, library, plan: plan("tags"), requirements: [], warning });
const done: TailorAi & { status: "done" } = { status: "done", untrimmed: [], trimmed: [] };

describe("tailorFlowTransition", () => {
    it("opens the review from the questions with the AI running", () => {
        const s = tailorFlowTransition(TAILOR_QUESTIONS, review(1, "answers saved"));
        expect(s).toMatchObject({ step: "review", run: 1, ai: { status: "running" }, warning: "answers saved" });
    });

    it("only opens a newer run (a double click on Skip starts one review)", () => {
        const first = tailorFlowTransition(TAILOR_QUESTIONS, review(1));
        expect(tailorFlowTransition(first, review(1))).toBe(first);
        expect(tailorFlowTransition(tailorFlowTransition(first, review(2)), { type: "settle", run: 1, ai: done, warning: null }).run).toBe(2);
    });

    it("takes the AI plan, keeping an earlier warning unless the AI has its own", () => {
        const open = tailorFlowTransition(TAILOR_QUESTIONS, review(1, "answers saved"));
        const kept = tailorFlowTransition(open, { type: "reviewed", run: 1, plan: plan("ai"), requirements: [], warning: null });
        expect(kept).toMatchObject({ plan: plan("ai"), warning: "answers saved", ai: { status: "running" } });
        const replaced = tailorFlowTransition(open, { type: "reviewed", run: 1, plan: plan("ai"), requirements: [], warning: "reconcile skipped" });
        expect(replaced).toMatchObject({ warning: "reconcile skipped" });
    });

    it("drops results from another run and anything after the run settled", () => {
        const open = tailorFlowTransition(TAILOR_QUESTIONS, review(1));
        expect(tailorFlowTransition(open, { type: "settle", run: 2, ai: done, warning: null })).toBe(open);
        const settled = tailorFlowTransition(open, { type: "settle", run: 1, ai: done, warning: "tag matching only" });
        expect(settled).toMatchObject({ ai: done, warning: "tag matching only" });
        expect(tailorFlowTransition(settled, { type: "settle", run: 1, ai: { status: "failed", message: "late" }, warning: null })).toBe(settled);
        expect(tailorFlowTransition(settled, { type: "reviewed", run: 1, plan: plan("late"), requirements: [], warning: null })).toBe(settled);
    });

    it("ignores AI events and warning dismissal before the review opens", () => {
        expect(tailorFlowTransition(TAILOR_QUESTIONS, { type: "settle", run: 0, ai: done, warning: null })).toBe(TAILOR_QUESTIONS);
        expect(tailorFlowTransition(TAILOR_QUESTIONS, { type: "dismissWarning" })).toBe(TAILOR_QUESTIONS);
    });

    it("dismisses the warning without touching the run", () => {
        const open = tailorFlowTransition(TAILOR_QUESTIONS, review(1, "w")) as Extract<TailorFlow, { step: "review" }>;
        const cleared = tailorFlowTransition(open, { type: "dismissWarning" });
        expect(cleared).toEqual({ ...open, warning: null });
        expect(tailorFlowTransition(cleared, { type: "dismissWarning" })).toBe(cleared);
    });
});
