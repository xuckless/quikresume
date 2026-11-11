import { describe, expect, it } from "vitest";
import { operationTransition, type Operation } from "@/lib/ui/operation";

type K = "a" | "b";
const idle: Operation<K, number> = { status: "idle" };
const running: Operation<K, number> = { status: "running", kind: "a", token: 1 };

describe("operationTransition", () => {
    it("admits start from idle and ignores it while running", () => {
        expect(operationTransition(idle, { type: "start", kind: "a", token: 1 })).toEqual(running);
        expect(operationTransition(running, { type: "start", kind: "b", token: 2 })).toBe(running);
    });
    it("ignores stale tokens", () => {
        expect(operationTransition(running, { type: "succeed", token: 2, result: 1 })).toBe(running);
        expect(operationTransition(running, { type: "fail", token: 2, error: "x" })).toBe(running);
        expect(operationTransition(running, { type: "step", token: 2, kind: "b" })).toBe(running);
        expect(operationTransition(idle, { type: "succeed", token: 1, result: 1 })).toBe(idle);
    });
    it("step relabels the running operation", () => {
        expect(operationTransition(running, { type: "step", token: 1, kind: "b" })).toEqual({ status: "running", kind: "b", token: 1 });
    });
    it("settles with the running kind", () => {
        expect(operationTransition(running, { type: "succeed", token: 1, result: 7 })).toEqual({ status: "succeeded", kind: "a", result: 7 });
        expect(operationTransition(running, { type: "fail", token: 1, error: "no" })).toEqual({ status: "failed", kind: "a", error: "no" });
    });
    it("reject applies only when not running", () => {
        expect(operationTransition(idle, { type: "reject", kind: "b", error: "big" })).toEqual({ status: "failed", kind: "b", error: "big" });
        expect(operationTransition(running, { type: "reject", kind: "b", error: "big" })).toBe(running);
    });
    it("reset abandons a running operation", () => {
        const next = operationTransition(running, { type: "reset" });
        expect(next).toEqual({ status: "idle" });
        expect(operationTransition(next, { type: "succeed", token: 1, result: 1 })).toBe(next);
    });
});
