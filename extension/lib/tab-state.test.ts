import { describe, expect, it } from "vitest";
import { AUTOFILL_TIMEOUT_MS, emptyState, isLegacyKey, settleInterrupted, stateKey } from "./tab-state";
import type { TabState, TailorResult } from "./types";

const none = () => false;
const result = { jobId: "j" } as TailorResult;
const counts = { filled: 0, drafted: 0, attached: null, unmapped: [] };
const withState = (patch: Partial<TabState>): TabState => ({ ...emptyState(), ...patch });

describe("settleInterrupted", () => {
    it("leaves an idle tab alone and returns the same object", () => {
        const s = emptyState();
        expect(settleInterrupted(s, 0, none)).toBe(s);
    });

    it("keeps a phase whose handler is alive", () => {
        const s = withState({ save: { phase: "saving" }, tailor: { phase: "running" } });
        expect(settleInterrupted(s, 0, () => true)).toBe(s);
    });

    it("turns a save or tailor run with no live handler into a retryable failure", () => {
        const out = settleInterrupted(withState({ save: { phase: "saving" }, tailor: { phase: "running" } }), 0, none);
        expect(out.save).toEqual({ phase: "failed", error: expect.stringContaining("interrupted") });
        expect(out.tailor).toEqual({ phase: "failed", error: expect.stringContaining("interrupted") });
    });

    it("keeps the plan when a tailor save was interrupted", () => {
        const out = settleInterrupted(withState({ tailor: { phase: "saving", result } }), 0, h => h === "tailor");
        expect(out.tailor).toMatchObject({ phase: "save-failed", result });
    });

    it("closes a silent Auto Fill after the timeout: no form, or complete when something was filled", () => {
        const running = (filled: number) => withState({ autofill: { phase: "running", startedAt: 1000, ...counts, filled } });
        const fresh = running(0);
        expect(settleInterrupted(fresh, 1000 + AUTOFILL_TIMEOUT_MS, none)).toBe(fresh);
        expect(settleInterrupted(running(0), 1001 + AUTOFILL_TIMEOUT_MS, none).autofill).toMatchObject({ phase: "failed", error: "No application form found on this page." });
        const done = settleInterrupted(running(3), 1001 + AUTOFILL_TIMEOUT_MS, none).autofill;
        expect(done).toMatchObject({ phase: "complete", filled: 3 });
        expect(done).not.toHaveProperty("startedAt");
    });
});

describe("state keys", () => {
    it("versions the stored shape and sweeps older keys only", () => {
        expect(isLegacyKey("tab:12")).toBe(true);
        expect(isLegacyKey("tab-state:v0:12")).toBe(true);
        expect(isLegacyKey(stateKey(12))).toBe(false);
        expect(isLegacyKey("something-else")).toBe(false);
    });
});
