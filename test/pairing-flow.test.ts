import { describe, expect, it } from "vitest";
import { idlePairing, pairingTransition as reduce, type PairingFlow } from "@/lib/ext/pairing-flow";

const code = { code: "ABCD1234", expiresAt: "soon" };
const awaiting: PairingFlow = { phase: "awaiting", code };

describe("pairingTransition", () => {
    it("admits one code request at a time", () => {
        const issuing = reduce(idlePairing, { type: "issue", mode: "automatic" });
        expect(reduce(issuing, { type: "issue", mode: "manual" })).toBe(issuing);
    });

    it("ignores a code or failure that arrives after the request was dropped", () => {
        const connected = reduce(reduce(idlePairing, { type: "issue", mode: "automatic" }), { type: "paired", ok: true });
        expect(reduce(connected, { type: "code", code })).toBe(connected);
        expect(reduce(connected, { type: "failed", error: "late" })).toBe(connected);
    });

    it("keeps the code on screen after an extension pairing error and restores it on dismiss", () => {
        const failed = reduce(awaiting, { type: "paired", ok: false, error: "offline" });
        expect(failed).toEqual({ phase: "pairing-failed", code, error: "offline" });
        expect(reduce(failed, { type: "dismiss" })).toEqual(awaiting);
    });

    it("fails the request when the extension errors before a code exists", () => {
        const issuing = reduce(idlePairing, { type: "issue", mode: "automatic" });
        expect(reduce(issuing, { type: "paired", ok: false })).toMatchObject({ phase: "failed" });
    });

    it("does not dismiss a request in flight", () => {
        const issuing = reduce(idlePairing, { type: "issue", mode: "manual" });
        expect(reduce(issuing, { type: "dismiss" })).toBe(issuing);
    });

    it("ignores a pairing error when nothing was started", () => {
        expect(reduce(idlePairing, { type: "paired", ok: false, error: "x" })).toBe(idlePairing);
    });
});
