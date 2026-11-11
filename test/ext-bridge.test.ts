import { afterEach, describe, expect, it, vi } from "vitest";
import { EXT_SOURCE, parseAppPayload, parseExtPayload, readExtMessage } from "@/lib/ext/bridge";

const ID = "12345678-1234-1234-1234-123456789abc";
afterEach(() => vi.unstubAllGlobals());

describe("readExtMessage", () => {
    it("accepts validated messages only from this window and origin", () => {
        const win = { location: { origin: "https://app.example" } };
        vi.stubGlobal("window", win);
        const data = { source: EXT_SOURCE, type: "hello", paired: true, version: "0.1.0", linkedIn: true };
        const event = (patch: object) => ({ source: win, origin: win.location.origin, data, ...patch }) as unknown as MessageEvent;
        expect(readExtMessage(event({}))).toEqual({ type: "hello", paired: true, version: "0.1.0", linkedIn: true });
        expect(readExtMessage(event({ source: {} }))).toBeNull();
        expect(readExtMessage(event({ origin: "https://evil.example" }))).toBeNull();
        expect(readExtMessage(event({ data: { ...data, source: "quikresume-app" } }))).toBeNull();
        expect(readExtMessage(event({ data: null }))).toBeNull();
    });
});

describe("parseExtPayload", () => {
    it("treats an extension without the flag as not supporting LinkedIn import", () => {
        expect(parseExtPayload({ type: "hello", version: "0.1.0", paired: true })).toMatchObject({ linkedIn: false });
        expect(parseExtPayload({ type: "hello", version: 1, paired: true })).toBeNull();
    });

    it("validates captured profiles: id, canonical URL, object payload, warnings", () => {
        const ok = { type: "linkedin-captured", id: ID, url: "https://linkedin.com/in/Alice", data: { personalInfo: { name: "Alice" } }, warnings: ["a", 3, "b"] };
        expect(parseExtPayload(ok)).toEqual({ type: "linkedin-captured", id: ID, url: "https://www.linkedin.com/in/alice", data: ok.data, warnings: ["a", "b"] });
        expect(parseExtPayload({ ...ok, id: "x" })).toBeNull();
        expect(parseExtPayload({ ...ok, url: "https://www.linkedin.com/in/alice/details/skills" })).toBeNull();
        expect(parseExtPayload({ ...ok, data: [] })).toBeNull();
        expect(parseExtPayload({ ...ok, data: { blob: "x".repeat(300_001) } })).toBeNull();
    });

    it("keeps errors short and maps unknown end reasons to other", () => {
        expect(parseExtPayload({ type: "linkedin-ended", id: ID, error: "x".repeat(1000), reason: "?" })).toEqual({ type: "linkedin-ended", id: ID, error: "x".repeat(300), reason: "other" });
        expect(parseExtPayload({ type: "linkedin-capture-failed", id: ID, error: "" })).toBeNull();
        expect(parseExtPayload({ type: "linkedin-analysing", id: ID, extra: 1 })).toEqual({ type: "linkedin-analysing", id: ID });
        expect(parseExtPayload({ type: "linkedin-analysing", id: "nope" })).toBeNull();
        expect(parseExtPayload({ type: "unknown" })).toBeNull();
    });
});

describe("parseAppPayload", () => {
    it("validates session messages from the page", () => {
        expect(parseAppPayload({ type: "linkedin-start", id: ID, uid: "abc123", url: "https://www.linkedin.com/in/alice/" })).toEqual({ type: "linkedin-start", id: ID, uid: "abc123", url: "https://www.linkedin.com/in/alice" });
        expect(parseAppPayload({ type: "linkedin-start", id: ID, uid: "a/b", url: "https://www.linkedin.com/in/alice" })).toBeNull();
        expect(parseAppPayload({ type: "linkedin-start", id: ID, uid: "abc", url: "https://evil.example/in/alice" })).toBeNull();
        expect(parseAppPayload({ type: "linkedin-received", id: ID, ok: true })).toEqual({ type: "linkedin-received", id: ID, ok: true });
        expect(parseAppPayload({ type: "linkedin-received", id: ID, ok: false })).toBeNull();
        expect(parseAppPayload({ type: "pair", code: "ABCD1234" })).toEqual({ type: "pair", code: "ABCD1234" });
    });
});
