import { describe, expect, it } from "vitest";
import { CAPTURE_REFUSED, idleSession, linkedInReducer as reduce, liveSessionId, sessionBusy, type LinkedInEvent, type LinkedInSession } from "@/lib/import/linkedin-session";
import { emptyResumeData } from "@/types/schema";

const URL_ = "https://www.linkedin.com/in/alice";
const hello = { type: "hello" as const, version: "1", paired: true, linkedIn: true };
const file = { fileName: "LinkedIn profile", data: emptyResumeData(), warnings: [] };
const run = (...events: LinkedInEvent[]) => events.reduce<LinkedInSession>(reduce, idleSession);
const waiting = () => run({ type: "start", id: "a" }, { type: "detected", id: "a", hello, savedUrl: URL_ }, { type: "linkedin-started", id: "a" });

describe("LinkedIn session (web)", () => {
    it("starts with the saved URL and lands in review on a capture", () => {
        const s = waiting();
        expect(s).toEqual({ phase: "waiting", id: "a", url: URL_, error: null, reject: false });
        const capturing = reduce(s, { type: "linkedin-capturing", id: "a" });
        expect(reduce(capturing, { type: "captured", id: "a", url: URL_, file })).toEqual({ phase: "received", id: "a", file });
    });

    it("sends the user to extension setup when it is missing, unpaired or outdated", () => {
        const after = (h: Parameters<typeof reduce>[1] & { type: "detected" }) => run({ type: "start", id: "a" }, h);
        expect(after({ type: "detected", id: "a", hello: null, savedUrl: URL_ })).toEqual({ phase: "extension-needed", reason: "missing" });
        expect(after({ type: "detected", id: "a", hello: { ...hello, paired: false }, savedUrl: URL_ })).toEqual({ phase: "extension-needed", reason: "pair" });
        expect(after({ type: "detected", id: "a", hello: { ...hello, linkedIn: false }, savedUrl: URL_ })).toEqual({ phase: "extension-needed", reason: "update" });
        expect(after({ type: "detected", id: "a", hello: { type: "disconnected" }, savedUrl: URL_ })).toMatchObject({ phase: "failed", fix: "reload" });
    });

    it("asks for a URL when none is saved, then starts with the saved one", () => {
        let s = run({ type: "start", id: "a" }, { type: "detected", id: "a", hello, savedUrl: null });
        expect(s).toEqual({ phase: "need-url", id: "a", saving: false, error: null });
        s = reduce(s, { type: "url-submitted", id: "a" });
        expect(reduce(s, { type: "url-dismissed", id: "a" })).toBe(s);
        expect(reduce(s, { type: "url-rejected", id: "a", error: "Bad URL" })).toMatchObject({ saving: false, error: "Bad URL" });
        expect(reduce(s, { type: "url-saved", id: "a", url: URL_ })).toEqual({ phase: "starting", id: "a", url: URL_ });
    });

    it("refuses a capture of another page or with nothing in it, and tells the extension", () => {
        const s = waiting();
        expect(reduce(s, { type: "captured", id: "a", url: "https://www.linkedin.com/in/bob", file })).toMatchObject({ phase: "waiting", error: CAPTURE_REFUSED.mismatch, reject: true });
        expect(reduce(s, { type: "captured", id: "a", url: URL_, file: null })).toMatchObject({ phase: "waiting", error: CAPTURE_REFUSED.empty, reject: true });
        expect(reduce(s, { type: "linkedin-capture-failed", id: "a", error: "Sign in" })).toMatchObject({ error: "Sign in", reject: false });
    });

    it("ignores events for another session, after cancel and after a restart", () => {
        const s = waiting();
        expect(reduce(s, { type: "captured", id: "b", url: URL_, file })).toBe(s);
        const cancelled = reduce(s, { type: "cancel" });
        expect(cancelled).toBe(idleSession);
        expect(reduce(cancelled, { type: "captured", id: "a", url: URL_, file })).toBe(cancelled);
        const restarted = reduce(cancelled, { type: "start", id: "b" });
        expect(reduce(restarted, { type: "detected", id: "a", hello, savedUrl: URL_ })).toBe(restarted);
        expect(reduce(s, { type: "start", id: "b" })).toBe(s);
    });

    it("fails clearly when the extension ends the session, goes silent or disconnects", () => {
        expect(reduce(waiting(), { type: "linkedin-ended", id: "a", error: "Other account", reason: "account" })).toEqual({ phase: "failed", error: "Other account", fix: "reconnect" });
        expect(reduce(waiting(), { type: "linkedin-ended", id: "a", error: "Tab closed", reason: "other" })).toMatchObject({ fix: "retry" });
        const starting = run({ type: "start", id: "a" }, { type: "detected", id: "a", hello, savedUrl: URL_ });
        expect(reduce(starting, { type: "start-timeout", id: "a" })).toMatchObject({ phase: "failed", fix: "reload" });
        expect(reduce(waiting(), { type: "disconnected" })).toMatchObject({ phase: "failed", fix: "reload" });
    });

    it("keeps following a received session (a later cancel is harmless) but allows a new start", () => {
        const received = reduce(waiting(), { type: "captured", id: "a", url: URL_, file });
        expect(liveSessionId(received)).toBe("a");
        expect(sessionBusy(received)).toBe(false);
        expect(reduce(received, { type: "disconnected" })).toBe(received);
        expect(reduce(received, { type: "start", id: "b" })).toEqual({ phase: "checking", id: "b" });
    });
});
