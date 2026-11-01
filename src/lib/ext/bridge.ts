// src/lib/ext/bridge.ts
// The page <-> extension message contract on the quikResume site. The extension's content script
// (extension/entrypoints/site.content.ts) runs only on the app's own origin, answers "ping" with
// "hello", and forwards "pair" to its background worker, which redeems the code at POST /api/ext/pair.
// Both sides check event.source === window and event.origin === location.origin.

export const APP_SOURCE = "quikresume-app";
export const EXT_SOURCE = "quikresume-ext";

export type AppMessage = { source: typeof APP_SOURCE; type: "ping" } | { source: typeof APP_SOURCE; type: "pair"; code: string };
export type ExtMessage =
    | { source: typeof EXT_SOURCE; type: "hello"; version: string; paired: boolean }
    | { source: typeof EXT_SOURCE; type: "paired"; ok: boolean; error?: string };

export function isExtMessage(e: MessageEvent): e is MessageEvent<ExtMessage> {
    return e.source === window && e.origin === window.location.origin && typeof e.data === "object" && e.data !== null && e.data.source === EXT_SOURCE;
}
