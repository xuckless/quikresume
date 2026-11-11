// src/lib/ext/bridge.ts
// The page <-> extension message contract on the quikResume site. The extension's content script
// (extension/entrypoints/site.content.ts) runs only on the app's own origin, answers "ping" with
// "hello", and forwards "pair" to its background worker, which redeems the code at POST /api/ext/pair.
// Both sides check event.source === window and event.origin === location.origin.

export const APP_SOURCE = "quikresume-app";
export const EXT_SOURCE = "quikresume-ext";

export type AppMessage = { source: typeof APP_SOURCE; type: "ping" } | { source: typeof APP_SOURCE; type: "pair"; code: string };
export type ExtMessage =
    | { source: typeof EXT_SOURCE; type: "hello"; version: string; paired: boolean; profileImport?: boolean }
    | { source: typeof EXT_SOURCE; type: "paired"; ok: boolean; error?: string };

export function isExtMessage(e: MessageEvent): e is MessageEvent<ExtMessage> {
    if (e.source !== window || e.origin !== window.location.origin || typeof e.data !== "object" || e.data === null || e.data.source !== EXT_SOURCE) return false;
    const d = e.data;
    return (d.type === "hello" && typeof d.version === "string" && d.version.length < 100 && typeof d.paired === "boolean") ||
        (d.type === "paired" && typeof d.ok === "boolean" && (d.error === undefined || typeof d.error === "string"));
}

/** Probe on demand so slow startup and pairing in another tab do not leave stale detection. */
export function detectProfileExtension(): Promise<Extract<ExtMessage, { type: "hello" }> | null> {
    return new Promise(resolve => {
        const finish = (result: Extract<ExtMessage, { type: "hello" }> | null) => {
            clearTimeout(timer);
            window.removeEventListener("message", receive);
            resolve(result);
        };
        const receive = (e: MessageEvent) => {
            if (isExtMessage(e) && e.data.type === "hello") finish(e.data);
        };
        const timer = setTimeout(() => finish(null), 3000);
        window.addEventListener("message", receive);
        window.postMessage({ source: APP_SOURCE, type: "ping" }, window.location.origin);
    });
}
