// src/lib/ext/bridge.ts
// The page <-> extension message contract, used by both sides: the app imports it as
// "@/lib/ext/bridge", the extension by relative path (so it stays free of "@/" imports and of anything
// that is not plain TypeScript). Every message is validated here and nowhere else.
//
//   page --window.postMessage--> site.content.ts (app origin only) --runtime port / message--> background
//
// The content script answers "ping" with "hello" and forwards "pair" itself; LinkedIn messages travel
// over a "linkedin-import" port to the background (extension/lib/linkedin-session.ts), whose replies the
// content script posts back to the page. Both sides check event.source === window and
// event.origin === location.origin before reading a message.

import { canonicalProfileUrl, MAX_CAPTURE_WARNINGS, MAX_PROFILE_JSON } from "../import/linkedin";

export const APP_SOURCE = "quikresume-app";
export const EXT_SOURCE = "quikresume-ext";
/** Name of the content script -> background port that carries one LinkedIn session. */
export const LINKEDIN_PORT = "linkedin-import";

/** LinkedIn session messages from the page (forwarded to the background). */
export type LinkedInAppPayload =
    | { type: "linkedin-start"; id: string; uid: string; url: string }
    | { type: "linkedin-cancel"; id: string }
    /** The page took the captured profile into its review step (or could not use it). */
    | { type: "linkedin-received"; id: string; ok: true }
    | { type: "linkedin-received"; id: string; ok: false; error: string };

export type AppPayload = { type: "ping" } | { type: "pair"; code: string } | LinkedInAppPayload;
export type AppMessage = AppPayload & { source: typeof APP_SOURCE };

/** LinkedIn session messages from the background (posted to the page). */
export type LinkedInExtPayload =
    | { type: "linkedin-started"; id: string }
    | { type: "linkedin-capturing"; id: string }
    /** The profile as an ImportEnvelope (src/lib/import/envelope.ts), validated by the page before review. */
    | { type: "linkedin-captured"; id: string; url: string; data: Record<string, unknown>; warnings: string[] }
    | { type: "linkedin-capture-failed"; id: string; error: string }
    /** The session is over on the extension side. `account`: paired with a different quikResume account. */
    | { type: "linkedin-ended"; id: string; error: string; reason: "account" | "other" };

export type ExtHello = { type: "hello"; version: string; paired: boolean; linkedIn: boolean };
export type ExtPayload =
    | ExtHello
    | { type: "paired"; ok: boolean; error?: string }
    | LinkedInExtPayload
    /** The content script lost the extension (reloaded or updated): this page must be reloaded. */
    | { type: "disconnected" };
export type ExtMessage = ExtPayload & { source: typeof EXT_SOURCE };

const MAX_ERROR = 300;
const SESSION_ID = /^[0-9a-f-]{36}$/;
const UID = /^[^\s/]{1,128}$/;

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === "object" && v !== null;
const sessionId = (v: unknown): string | null => (typeof v === "string" && SESSION_ID.test(v) ? v : null);
const errorText = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.slice(0, MAX_ERROR) : null);

/** A LinkedIn session message from the page, or null. Also used by the background on its port. */
export function parseLinkedInAppPayload(d: unknown): LinkedInAppPayload | null {
    if (!isObject(d)) return null;
    const id = sessionId(d.id);
    if (!id) return null;
    switch (d.type) {
        case "linkedin-start": {
            const url = typeof d.url === "string" ? canonicalProfileUrl(d.url) : null;
            return typeof d.uid === "string" && UID.test(d.uid) && url ? { type: d.type, id, uid: d.uid, url } : null;
        }
        case "linkedin-cancel":
            return { type: d.type, id };
        case "linkedin-received": {
            if (d.ok === true) return { type: d.type, id, ok: true };
            const error = errorText(d.error);
            return d.ok === false && error ? { type: d.type, id, ok: false, error } : null;
        }
        default:
            return null;
    }
}

/** Any message from the page, or null. */
export function parseAppPayload(d: unknown): AppPayload | null {
    if (!isObject(d)) return null;
    if (d.type === "ping") return { type: "ping" };
    if (d.type === "pair") return typeof d.code === "string" && d.code.length <= 16 ? { type: "pair", code: d.code } : null;
    return parseLinkedInAppPayload(d);
}

/** A LinkedIn session message from the background, or null. */
export function parseLinkedInExtPayload(d: unknown): LinkedInExtPayload | null {
    if (!isObject(d)) return null;
    const id = sessionId(d.id);
    if (!id) return null;
    switch (d.type) {
        case "linkedin-started":
        case "linkedin-capturing":
            return { type: d.type, id };
        case "linkedin-captured": {
            const url = typeof d.url === "string" ? canonicalProfileUrl(d.url) : null;
            if (!url || !isObject(d.data) || Array.isArray(d.data) || JSON.stringify(d.data).length > MAX_PROFILE_JSON) return null;
            const warnings = Array.isArray(d.warnings) ? d.warnings.flatMap(w => errorText(w) ?? []).slice(0, MAX_CAPTURE_WARNINGS) : [];
            return { type: d.type, id, url, data: d.data, warnings };
        }
        case "linkedin-capture-failed": {
            const error = errorText(d.error);
            return error ? { type: d.type, id, error } : null;
        }
        case "linkedin-ended": {
            const error = errorText(d.error);
            return error ? { type: d.type, id, error, reason: d.reason === "account" ? "account" : "other" } : null;
        }
        default:
            return null;
    }
}

/** Any message from the extension, or null. */
export function parseExtPayload(d: unknown): ExtPayload | null {
    if (!isObject(d)) return null;
    switch (d.type) {
        case "hello":
            return typeof d.version === "string" && d.version.length < 100 && typeof d.paired === "boolean"
                ? { type: "hello", version: d.version, paired: d.paired, linkedIn: d.linkedIn === true }
                : null;
        case "paired":
            if (typeof d.ok !== "boolean") return null;
            return d.error === undefined ? { type: "paired", ok: d.ok } : typeof d.error === "string" ? { type: "paired", ok: d.ok, error: d.error.slice(0, MAX_ERROR) } : null;
        case "disconnected":
            return { type: "disconnected" };
        default:
            return parseLinkedInExtPayload(d);
    }
}

const fromThisPage = (e: MessageEvent) => e.source === window && e.origin === window.location.origin && isObject(e.data);

/** The validated extension message carried by a window "message" event, or null. */
export function readExtMessage(e: MessageEvent): ExtPayload | null {
    return fromThisPage(e) && e.data.source === EXT_SOURCE ? parseExtPayload(e.data) : null;
}

/** The validated page message carried by a window "message" event, or null (content script side). */
export function readAppMessage(e: MessageEvent): AppPayload | null {
    return fromThisPage(e) && e.data.source === APP_SOURCE ? parseAppPayload(e.data) : null;
}

export function isExtMessage(e: MessageEvent): e is MessageEvent<ExtMessage> {
    return readExtMessage(e) !== null;
}

export function postToExtension(m: AppPayload): void {
    window.postMessage({ source: APP_SOURCE, ...m } satisfies AppMessage, window.location.origin);
}

/**
 * Pings the extension and resolves with its "hello", with "disconnected" when an orphaned content script
 * answers (the extension was reloaded since this page loaded), or null when nothing answers in time.
 * Probed on demand, so pairing in another tab is never stale.
 */
export function detectExtension(timeoutMs = 3000): { result: Promise<ExtHello | { type: "disconnected" } | null>; cancel: () => void } {
    let cancel = () => {};
    const result = new Promise<ExtHello | { type: "disconnected" } | null>(resolve => {
        const finish = (value: ExtHello | { type: "disconnected" } | null) => {
            clearTimeout(timer);
            window.removeEventListener("message", receive);
            resolve(value);
        };
        const receive = (e: MessageEvent) => {
            const m = readExtMessage(e);
            if (m?.type === "hello" || m?.type === "disconnected") finish(m);
        };
        const timer = setTimeout(() => finish(null), timeoutMs);
        cancel = () => {
            clearTimeout(timer);
            window.removeEventListener("message", receive);
        };
        window.addEventListener("message", receive);
        postToExtension({ type: "ping" });
    });
    return { result, cancel };
}
