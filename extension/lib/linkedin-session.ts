// Extension side of "Import from LinkedIn": one session at a time, owned by the background worker.
// The app's Import page starts it over a "linkedin-import" port (entrypoints/site.content.ts relays
// window messages, src/lib/ext/bridge.ts types and validates them); the side panel shows it on the
// LinkedIn tab and asks for the capture; the profile, parsed from the page DOM into an ImportEnvelope
// (lib/profile-extract.ts, no AI), goes back to the page, which opens its review step.
//
//   idle -start-> opening (account check, new tab) -opened-> waiting (user signs in, opens the profile)
//   waiting -capture-> capturing -captured-> sending (the page validates it)
//   capture failure, or the page refusing the capture -> waiting with the error (Import again retries)
//   sending -received ok-> done (big checkmark; the tab stays open)
//   cancel from the page, tab closed, page gone, account mismatch -> ended (error shown) -dismiss-> idle
//
// Security: ports are accepted only from the app origin; the paired account must be the uid the page
// sent (checked at start and again before each capture); the tab's canonical URL must equal the
// expected URL before and after the capture; the payload is capped at MAX_PROFILE_JSON.
// Web-side counterpart: src/lib/import/linkedin-session.ts.

import {
    LINKEDIN_PORT, parseLinkedInAppPayload,
    type LinkedInAppPayload, type LinkedInExtPayload,
} from "../../src/lib/ext/bridge";
import { canonicalProfileUrl, MAX_PROFILE_JSON } from "../../src/lib/import/linkedin";
import type { CaptureResult } from "./profile-merge";

export type LinkedInState =
    | { phase: "idle" }
    | { phase: "opening"; id: string; url: string }
    | { phase: "waiting"; id: string; url: string; tabId: number; error: string | null }
    | { phase: "capturing"; id: string; url: string; tabId: number }
    | { phase: "sending"; id: string; url: string; tabId: number }
    | { phase: "done"; id: string; url: string; tabId: number }
    | { phase: "ended"; id: string; url: string; tabId: number | null; error: string };

export type LinkedInEvent =
    | { type: "start"; id: string; url: string }
    | { type: "opened"; id: string; tabId: number }
    | { type: "capture"; id: string }
    | { type: "captured"; id: string }
    | { type: "capture-failed"; id: string; error: string }
    | { type: "received"; id: string; ok: true }
    | { type: "received"; id: string; ok: false; error: string }
    | { type: "end"; id: string; error: string }
    | { type: "dismiss" };

export const IDLE: LinkedInState = { phase: "idle" };

/** A session the page is still following (it must hear how it ends). */
export function isLive(s: LinkedInState): s is Extract<LinkedInState, { phase: "opening" | "waiting" | "capturing" | "sending" }> {
    return s.phase === "opening" || s.phase === "waiting" || s.phase === "capturing" || s.phase === "sending";
}

/** Pure transitions. Returns the same object when the event does not apply (stale id, wrong phase). */
export function reduceLinkedIn(s: LinkedInState, e: LinkedInEvent): LinkedInState {
    if (e.type === "start") return s.phase !== "idle" && s.id === e.id ? s : { phase: "opening", id: e.id, url: e.url };
    if (e.type === "dismiss") return s.phase === "done" || s.phase === "ended" ? IDLE : s;
    if (s.phase === "idle" || s.id !== e.id) return s;
    const tabId = "tabId" in s ? s.tabId : null;
    switch (e.type) {
        case "opened":
            return s.phase === "opening" ? { phase: "waiting", id: s.id, url: s.url, tabId: e.tabId, error: null } : s;
        case "capture":
            return s.phase === "waiting" ? { phase: "capturing", id: s.id, url: s.url, tabId: s.tabId } : s;
        case "captured":
            return s.phase === "capturing" ? { phase: "sending", id: s.id, url: s.url, tabId: s.tabId } : s;
        case "capture-failed":
            return s.phase === "capturing" ? { phase: "waiting", id: s.id, url: s.url, tabId: s.tabId, error: e.error } : s;
        case "received":
            if (s.phase !== "sending") return s;
            return e.ok ? { phase: "done", id: s.id, url: s.url, tabId: s.tabId } : { phase: "waiting", id: s.id, url: s.url, tabId: s.tabId, error: e.error };
        case "end":
            return isLive(s) ? { phase: "ended", id: s.id, url: s.url, tabId, error: e.error } : s;
    }
}

/** Side panel -> background requests for this feature. */
export type LinkedInRequest =
    | { type: "linkedin-state" }
    | { type: "linkedin-capture"; id: string }
    | { type: "linkedin-dismiss" };

/** Background -> profile content script (entrypoints/linkedin-profile.content.ts). */
export type ProfileTabRequest = { type: "profile-page" } | { type: "capture-profile"; url: string };
export type ProfilePageReply = { loginWall: boolean };
export type CaptureReply = ({ ok: true } & CaptureResult) | { ok: false; error: string };

export const MESSAGES = {
    mismatch: "This tab is not the LinkedIn profile saved in quikResume. Open your profile, then click Import.",
    moved: "LinkedIn moved to another page during the import. Open your profile again, then click Import.",
    account: "The extension is connected to a different quikResume account. Reconnect it on quikResume, then start again.",
    cancelled: "The import was cancelled on quikResume. Start it again from the Import page.",
    pageGone: "The quikResume page was closed or reloaded. Start the import again from the Import page.",
    tabClosed: "The LinkedIn tab was closed. Start the import again from quikResume.",
    replaced: "A new LinkedIn import was started.",
    interrupted: "The extension restarted and the import stopped. Start it again from quikResume.",
    noTab: "Couldn't open LinkedIn. Start the import again from quikResume.",
};

const STORE_KEY = "linkedin";
const PROFILE_SCRIPT = "/content-scripts/linkedin-profile.js";
const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

export type LinkedInImport = ReturnType<typeof createLinkedInImport>;

interface Deps {
    /** Origin of the quikResume app; ports from anywhere else are refused. */
    appOrigin: string;
    /** Id of the quikResume account this extension is paired with (throws when unpaired). */
    accountId: () => Promise<string>;
}

/**
 * The background's LinkedIn import: holds the one session (mirrored to chrome.storage.session so a
 * restarted worker can report an interrupted import), the port of the page that owns it, and the
 * handlers background.ts wires to Chrome events.
 */
export function createLinkedInImport({ appOrigin, accountId }: Deps) {
    let state: LinkedInState = IDLE;
    /** The page port that started the current session, and that session's uid. */
    let owner: { id: string; uid: string; port: chrome.runtime.Port } | null = null;

    // A worker that restarts mid-session has lost the page's port: show the import as interrupted.
    const loaded = chrome.storage.session.get(STORE_KEY).then(v => {
        const saved = v[STORE_KEY] as LinkedInState | undefined;
        if (saved && saved.phase !== "idle") state = isLive(saved) ? { phase: "ended", id: saved.id, url: saved.url, tabId: "tabId" in saved ? saved.tabId : null, error: MESSAGES.interrupted } : saved;
    }).catch(() => undefined);

    /** Applies an event; false when the reducer ignored it (stale id or wrong phase). */
    function dispatch(event: LinkedInEvent): boolean {
        const next = reduceLinkedIn(state, event);
        if (next === state) return false;
        state = next;
        void chrome.storage.session.set({ [STORE_KEY]: state }).catch(() => undefined);
        chrome.runtime.sendMessage({ type: "linkedin-changed" }).catch(() => undefined);
        return true;
    }

    function send(id: string, payload: LinkedInExtPayload) {
        if (owner?.id !== id) return;
        try {
            owner.port.postMessage(payload);
        } catch {
            // The page went away; its disconnect handler ends the session.
        }
    }

    function end(id: string, error: string, reason: "account" | "other" = "other") {
        if (dispatch({ type: "end", id, error })) send(id, { type: "linkedin-ended", id, error, reason });
    }

    async function start(port: chrome.runtime.Port, m: Extract<LinkedInAppPayload, { type: "linkedin-start" }>) {
        if (state.phase !== "idle" && state.id === m.id) return;
        if (isLive(state)) end(state.id, MESSAGES.replaced);
        owner = { id: m.id, uid: m.uid, port };
        dispatch({ type: "start", id: m.id, url: m.url });
        try {
            if ((await accountId()) !== m.uid) return end(m.id, MESSAGES.account, "account");
        } catch (err) {
            return end(m.id, errorText(err, MESSAGES.account), "account");
        }
        if (state.phase !== "opening" || state.id !== m.id) return;
        const tab = await chrome.tabs.create({ url: m.url }).catch(() => null);
        if (tab?.id === undefined) return end(m.id, MESSAGES.noTab);
        if (!dispatch({ type: "opened", id: m.id, tabId: tab.id })) return;
        send(m.id, { type: "linkedin-started", id: m.id });
        // Only works with a user gesture; otherwise the page tells the user to open the panel.
        chrome.sidePanel.open({ tabId: tab.id }).catch(() => undefined);
    }

    async function tabProfileUrl(tabId: number): Promise<string | null> {
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        return canonicalProfileUrl(tab?.url ?? "");
    }

    /** Asks the tab's profile script for the text; injects it first into tabs opened before it loaded. */
    async function captureInTab(tabId: number, url: string): Promise<CaptureReply> {
        const request: ProfileTabRequest = { type: "capture-profile", url };
        try {
            return (await chrome.tabs.sendMessage(tabId, request)) as CaptureReply;
        } catch {
            await chrome.scripting.executeScript({ target: { tabId }, files: [PROFILE_SCRIPT] });
            return (await chrome.tabs.sendMessage(tabId, request)) as CaptureReply;
        }
    }

    async function capture(id: string) {
        if (!dispatch({ type: "capture", id }) || state.phase !== "capturing") return;
        const { tabId, url } = state;
        send(id, { type: "linkedin-capturing", id });
        const fail = (error: string) => {
            if (dispatch({ type: "capture-failed", id, error })) send(id, { type: "linkedin-capture-failed", id, error });
        };
        try {
            if (owner?.id !== id || (await accountId()) !== owner.uid) return end(id, MESSAGES.account, "account");
        } catch (err) {
            return end(id, errorText(err, MESSAGES.account), "account");
        }
        if ((await tabProfileUrl(tabId)) !== url) return fail(MESSAGES.mismatch);
        let reply: CaptureReply;
        try {
            reply = (await captureInTab(tabId, url)) ?? { ok: false, error: "The profile page did not answer. Reload it, then click Import." };
        } catch (err) {
            reply = { ok: false, error: errorText(err, "Couldn't read this page. Reload it, then click Import.") };
        }
        if ((await tabProfileUrl(tabId)) !== url) return fail(MESSAGES.moved);
        if (!reply.ok) return fail(reply.error);
        if (JSON.stringify(reply.data).length > MAX_PROFILE_JSON) return fail("Your profile is too long to import.");
        if (dispatch({ type: "captured", id })) {
            send(id, { type: "linkedin-captured", id, url, data: reply.data as Record<string, unknown>, warnings: reply.warnings });
        }
    }

    function onPortMessage(port: chrome.runtime.Port, raw: unknown) {
        const m = parseLinkedInAppPayload(raw);
        if (!m) return; // keepalive pings and anything malformed
        if (m.type === "linkedin-start") return void start(port, m);
        if (owner?.port !== port || owner.id !== m.id) return;
        if (m.type === "linkedin-cancel") end(m.id, MESSAGES.cancelled);
        else dispatch(m.ok ? { type: "received", id: m.id, ok: true } : { type: "received", id: m.id, ok: false, error: m.error });
    }

    return {
        onConnect(port: chrome.runtime.Port) {
            if (port.name !== LINKEDIN_PORT) return;
            let origin = "";
            try {
                origin = new URL(port.sender?.url ?? "").origin;
            } catch { /* refused below */ }
            if (origin !== appOrigin || port.sender?.tab?.id === undefined) {
                port.disconnect();
                return;
            }
            port.onMessage.addListener(raw => void loaded.then(() => onPortMessage(port, raw)));
            port.onDisconnect.addListener(() => {
                if (owner?.port !== port) return;
                const id = owner.id;
                owner = null;
                void loaded.then(() => end(id, MESSAGES.pageGone));
            });
        },
        onTabRemoved(tabId: number) {
            void loaded.then(() => {
                if (isLive(state) && "tabId" in state && state.tabId === tabId) end(state.id, MESSAGES.tabClosed);
                else if ((state.phase === "done" || state.phase === "ended") && state.tabId === tabId) dispatch({ type: "dismiss" });
            });
        },
        /** Side panel requests; resolves with the state for "linkedin-state". */
        async handle(msg: LinkedInRequest): Promise<LinkedInState | null> {
            await loaded;
            if (msg.type === "linkedin-state") return state;
            if (msg.type === "linkedin-capture") void capture(msg.id);
            else dispatch({ type: "dismiss" });
            return null;
        },
    };
}
