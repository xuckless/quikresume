// src/lib/import/linkedin-session.ts
// Web side of one "Import from LinkedIn" session (components/ui/linkedin-import.tsx). Every event that
// belongs to a session carries its id; events for another id are ignored, so a late reply from a
// cancelled or replaced session can never move the current one. No AI: the extension sends the profile
// already structured, and it goes straight to the Import review step.
//
//   idle -start-> checking -detected-> extension-needed (missing / unpaired / outdated: set it up first)
//                                   -> need-url (no saved profile URL) -url-saved-> starting
//                                   -> starting (linkedin-start sent) -linkedin-started-> waiting
//   waiting -linkedin-capturing-> capturing -linkedin-captured-> received (in review; the page acknowledges)
//   capture failure -> waiting with the error (the user retries from the extension)
//   an unusable capture -> waiting with the error, and the extension is told (`reject`)
//   the extension ended the session, went silent or was reloaded -> failed; cancel -> idle
//
// Extension-side counterpart: extension/lib/linkedin-session.ts.

import type { ExtHello, LinkedInExtPayload } from "@/lib/ext/bridge";
import type { ParsedFile } from "./merge";

/** Why the extension can't be used yet; also `?reason=` on /dashboard/extension. */
export type ExtensionReason = "missing" | "pair" | "update";
/** What fixes a failed session: start again, reload this page, or reconnect the extension. */
export type LinkedInFix = "retry" | "reload" | "reconnect";

export type LinkedInSession =
    | { phase: "idle" }
    | { phase: "checking"; id: string }
    | { phase: "need-url"; id: string; saving: boolean; error: string | null }
    | { phase: "starting"; id: string; url: string }
    /** `reject`: the error is about a capture this page refused; the extension must hear it. */
    | { phase: "waiting"; id: string; url: string; error: string | null; reject: boolean }
    | { phase: "capturing"; id: string; url: string }
    | { phase: "received"; id: string; file: ParsedFile }
    | { phase: "extension-needed"; reason: ExtensionReason }
    | { phase: "failed"; error: string; fix: LinkedInFix };

/** `linkedin-captured` from the bridge, already turned into a review file (or refused) by the page. */
export type CapturedEvent = { type: "captured"; id: string; url: string; file: ParsedFile | null };

export type LinkedInEvent =
    | { type: "start"; id: string }
    | { type: "detected"; id: string; hello: ExtHello | { type: "disconnected" } | null; savedUrl: string | null }
    | { type: "url-submitted"; id: string }
    | { type: "url-saved"; id: string; url: string }
    | { type: "url-rejected"; id: string; error: string }
    | { type: "url-dismissed"; id: string }
    | { type: "start-timeout"; id: string }
    | Exclude<LinkedInExtPayload, { type: "linkedin-captured" }>
    | CapturedEvent
    | { type: "disconnected" }
    | { type: "cancel" };

export const idleSession: LinkedInSession = { phase: "idle" };

const RELOAD = "The extension was updated or reloaded. Reload this page, then try again.";
const SILENT = "The extension didn't respond. Reload this page, then try again.";
export const CAPTURE_REFUSED = {
    mismatch: "The captured page is not your saved profile.",
    empty: "Nothing could be read from your profile.",
};

/** The id of a session the extension is following (it must hear about a cancel), or "". */
export function liveSessionId(s: LinkedInSession): string {
    return s.phase === "starting" || s.phase === "waiting" || s.phase === "capturing" || s.phase === "received" ? s.id : "";
}

/** True while a session is under way (the Start button is hidden, file analysis waits). */
export function sessionBusy(s: LinkedInSession): boolean {
    return s.phase === "checking" || s.phase === "need-url" || s.phase === "starting" || s.phase === "waiting" || s.phase === "capturing";
}

export const LINKEDIN_STEPS = ["Connect the extension", "Open your profile", "Import in the extension"] as const;

/** Index into LINKEDIN_STEPS of the step in progress. */
export function sessionStep(s: LinkedInSession): number {
    return s.phase === "starting" ? 1 : s.phase === "waiting" || s.phase === "capturing" ? 2 : 0;
}

function detected(id: string, hello: ExtHello | { type: "disconnected" } | null, savedUrl: string | null): LinkedInSession {
    if (!hello) return { phase: "extension-needed", reason: "missing" };
    if (hello.type === "disconnected") return { phase: "failed", error: RELOAD, fix: "reload" };
    if (!hello.linkedIn) return { phase: "extension-needed", reason: "update" };
    if (!hello.paired) return { phase: "extension-needed", reason: "pair" };
    return savedUrl ? { phase: "starting", id, url: savedUrl } : { phase: "need-url", id, saving: false, error: null };
}

function captured(s: Extract<LinkedInSession, { phase: "waiting" | "capturing" }>, e: CapturedEvent): LinkedInSession {
    const refuse = (error: string): LinkedInSession => ({ phase: "waiting", id: s.id, url: s.url, error, reject: true });
    if (e.url !== s.url) return refuse(CAPTURE_REFUSED.mismatch);
    return e.file ? { phase: "received", id: s.id, file: e.file } : refuse(CAPTURE_REFUSED.empty);
}

export function linkedInReducer(s: LinkedInSession, e: LinkedInEvent): LinkedInSession {
    switch (e.type) {
        case "start":
            return sessionBusy(s) ? s : { phase: "checking", id: e.id };
        case "cancel":
            return sessionBusy(s) ? idleSession : s;
        case "disconnected":
            return sessionBusy(s) && s.phase !== "checking" && s.phase !== "need-url" ? { phase: "failed", error: RELOAD, fix: "reload" } : s;
    }
    if (!("id" in s) || s.id !== e.id) return s;
    switch (e.type) {
        case "detected":
            return s.phase === "checking" ? detected(s.id, e.hello, e.savedUrl) : s;
        case "url-submitted":
            return s.phase === "need-url" && !s.saving ? { ...s, saving: true, error: null } : s;
        case "url-saved":
            return s.phase === "need-url" ? { phase: "starting", id: s.id, url: e.url } : s;
        case "url-rejected":
            return s.phase === "need-url" ? { ...s, saving: false, error: e.error } : s;
        case "url-dismissed":
            return s.phase === "need-url" && !s.saving ? idleSession : s;
        case "start-timeout":
            return s.phase === "starting" ? { phase: "failed", error: SILENT, fix: "reload" } : s;
        case "linkedin-started":
            return s.phase === "starting" ? { phase: "waiting", id: s.id, url: s.url, error: null, reject: false } : s;
        case "linkedin-capturing":
            return s.phase === "waiting" ? { phase: "capturing", id: s.id, url: s.url } : s;
        case "captured":
            return s.phase === "waiting" || s.phase === "capturing" ? captured(s, e) : s;
        case "linkedin-capture-failed":
            return s.phase === "waiting" || s.phase === "capturing" ? { phase: "waiting", id: s.id, url: s.url, error: e.error, reject: false } : s;
        case "linkedin-ended":
            return sessionBusy(s) ? { phase: "failed", error: e.error, fix: e.reason === "account" ? "reconnect" : "retry" } : s;
    }
}
