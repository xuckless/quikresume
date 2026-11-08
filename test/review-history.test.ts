import { describe, expect, it } from "vitest";
import { historyConflict, mergeHistory, resolveOutcomes, rewriteProblem, type ReviewHistoryEntry } from "@/lib/review/history";
import { parseReviewReply } from "@/lib/review/parse";
import type { ReviewInput } from "@/lib/review/content";

const bullets = [
    "Developed the payments ledger service in Go",
    "Helped migrate the monolith to microservices on Kubernetes",
    "Was responsible for on-call and incident response for checkout APIs",
    "Reduced p99 latency of the authorization API from 420ms to 180ms by adding Redis caching",
];
const input = (history?: ReviewHistoryEntry[]): ReviewInput => ({
    id: "w1", target: "workExperience", label: "Senior Software Engineer", meta: "",
    fields: { title: "Senior Software Engineer", company: "Lumen Payments (Fictional)", description: bullets }, history,
});
const reply = (suggestions: { field: string; current: string; proposed: string }[]) =>
    ({ reviews: [{ id: "w1", score: 7, flags: [], comment: "ok", suggestions: suggestions.map(s => ({ ...s, reason: "r" })) }] });

describe("rewriteProblem", () => {
    it("treats a strong-verb synonym swap as equivalent", () => {
        expect(rewriteProblem("Developed the payments ledger service in Go", "Built and shipped the payments ledger service in Go")).toBe("equivalent");
    });
    it("keeps a real weak-verb fix", () => {
        expect(rewriteProblem("Was responsible for on-call and incident response for checkout APIs", "Owned on-call and incident response for checkout APIs")).toBeNull();
        expect(rewriteProblem("Worked on the payments ledger service written in Go", "Developed the payments ledger service in Go")).toBeNull();
    });
    it("keeps mechanical fixes (punctuation, first person)", () => {
        expect(rewriteProblem("I built the ledger service.", "Built the ledger service")).toBeNull();
    });
    it("rejects an ownership upgrade", () => {
        expect(rewriteProblem("Helped migrate the monolith to microservices on Kubernetes", "Migrated the monolith to microservices on Kubernetes")).toBe("ownership");
        expect(rewriteProblem("Helped migrate the monolith to microservices", "Contributed to migrating the monolith to microservices")).toBeNull();
    });
    it("rejects an invented outcome clause", () => {
        expect(rewriteProblem("Migrated the monolith to microservices on Kubernetes", "Migrated the monolith to microservices on Kubernetes, cutting deployment coupling across services")).toBe("new-outcome");
        expect(rewriteProblem("Cut build times by caching layers", "Cut build times by caching Docker layers")).not.toBe("new-outcome");
    });
    it("lets a placeholder company fix through", () => {
        expect(rewriteProblem("Lumen Payments (Fictional)", "Lumen Payments")).toBeNull();
    });
});

describe("history", () => {
    it("resolves accepted and dismissed suggestions from the current text", () => {
        const out = resolveOutcomes(input(), [
            { id: "a", field: "description", current: "Worked on the payments ledger service written in Go", proposed: "Developed the payments ledger service in Go" },
            { id: "b", field: "description", current: "Mentored two interns", proposed: "Mentored 2 interns" },
            { id: "c", field: "company", current: "Lumen Payments (Fictional)", proposed: "Lumen Payments" },
        ], ["c"]);
        expect(out.map(o => [o.kind, o.proposed])).toEqual([["accepted", "Developed the payments ledger service in Go"], ["rejected", "Lumen Payments"]]);
    });
    it("dedupes and caps", () => {
        const e: ReviewHistoryEntry = { field: "description", kind: "accepted", current: "x", proposed: "y" };
        expect(mergeHistory([e], [{ ...e, proposed: "Y." }])).toHaveLength(1);
        expect(mergeHistory(Array.from({ length: 50 }, (_, i) => ({ ...e, proposed: `p${i}` })))).toHaveLength(30);
    });
    it("flags a rewrite of an accepted line and a re-offered declined one", () => {
        const h: ReviewHistoryEntry[] = [
            { field: "description", kind: "accepted", current: "Worked on the payments ledger service written in Go", proposed: "Developed the payments ledger service in Go" },
            { field: "company", kind: "rejected", current: "Lumen Payments (Fictional)", proposed: "Lumen Payments" },
        ];
        expect(historyConflict("description", "Developed the payments ledger service in Go", "Engineered the payments ledger service in Go", h)).toBe("accepted-line");
        expect(historyConflict("company", "Lumen Payments (Fictional)", "Lumen Payments", h)).toBe("declined");
        expect(historyConflict("description", bullets[2], "Owned on-call and incident response for checkout APIs", h)).toBeNull();
    });
});

describe("parseReviewReply convergence", () => {
    it("drops synonym swaps, ownership upgrades, invented outcomes and rewrites of accepted lines", () => {
        const history: ReviewHistoryEntry[] = [{ field: "description", kind: "accepted", current: "Worked on the payments ledger service written in Go", proposed: bullets[0] }];
        const out = parseReviewReply(reply([
            { field: "description", current: bullets[0], proposed: "Built and shipped the payments ledger service in Go" },
            { field: "description", current: bullets[1], proposed: "Migrated the monolith to microservices on Kubernetes" },
            { field: "description", current: bullets[3], proposed: "Reduced p99 latency of the authorization API from 420ms to 180ms by adding Redis caching, improving checkout reliability" },
            { field: "description", current: bullets[2], proposed: "Owned on-call and incident response for checkout APIs" },
        ]), [input(history)]);
        expect(out.w1.suggestions.map(s => s.proposed)).toEqual(["Owned on-call and incident response for checkout APIs"]);
    });
    it("reaches a fixed point: no suggestions once only cosmetic rewrites remain", () => {
        const out = parseReviewReply(reply([
            { field: "description", current: bullets[0], proposed: "Engineered the payments ledger service in Go" },
        ]), [input()]);
        expect(out.w1.suggestions).toEqual([]);
    });
});
