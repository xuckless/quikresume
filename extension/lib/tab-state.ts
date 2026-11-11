// Per-tab state helpers for the background worker (entrypoints/background.ts), kept pure so they test.
//
// TabState lives in chrome.storage.session, which outlives the worker (it is suspended after ~30 s idle)
// and may outlive an extension reload. Two consequences:
//  - The stored shape is versioned through the storage key. Change TabState incompatibly -> bump
//    STATE_VERSION; old keys are never read (and `legacyKeys` lets the worker sweep them).
//  - A phase that says "in flight" is only true while a handler in THIS worker is still running (its
//    promise dies with the worker). `settleInterrupted` turns a phase with no live handler into a
//    failure the user can retry, instead of a spinner that never ends.

import type { TabState } from "./types";

export const STATE_VERSION = 1;
const PREFIX = "tab-state";

export const stateKey = (tabId: number) => `${PREFIX}:v${STATE_VERSION}:${tabId}`;
/** Session keys written by earlier shapes (the unversioned "tab:<id>" and older versions). */
export const isLegacyKey = (k: string) => /^tab:\d+$/.test(k) || (k.startsWith(`${PREFIX}:v`) && !k.startsWith(`${PREFIX}:v${STATE_VERSION}:`));

/** Background handlers that hold a phase open while they await the server. */
export type Handler = "save" | "tailor" | "tailor-save";

/** Auto Fill reports arrive from content scripts; a form-less page never reports, so a run is closed after this. */
export const AUTOFILL_TIMEOUT_MS = 45_000;

export const emptyState = (): TabState => ({ posting: null, summary: null, save: { phase: "idle" }, notice: null, autofill: null, tailor: null });

/**
 * `s` with every phase that no live work backs turned into its failure:
 * a save / tailor whose handler is gone, and an Auto Fill nobody reported on for AUTOFILL_TIMEOUT_MS
 * (complete when something was already filled, as before; otherwise "no form"). Returns `s` itself when
 * nothing changed.
 */
export function settleInterrupted(s: TabState, now: number, live: (h: Handler) => boolean): TabState {
    let next = s;
    if (s.save.phase === "saving" && !live("save")) {
        next = { ...next, save: { phase: "failed", error: "Saving was interrupted. Try again." } };
    }
    const t = s.tailor;
    if (t?.phase === "running" && !live("tailor")) {
        next = { ...next, tailor: { phase: "failed", error: "Tailoring was interrupted. Try again." } };
    } else if (t?.phase === "saving" && !live("tailor-save")) {
        next = { ...next, tailor: { phase: "save-failed", result: t.result, error: "Saving was interrupted. Try again." } };
    }
    const a = s.autofill;
    if (a?.phase === "running" && now - a.startedAt > AUTOFILL_TIMEOUT_MS) {
        const { startedAt: _startedAt, ...counts } = a;
        next = {
            ...next,
            autofill: a.filled || a.drafted
                ? { ...counts, phase: "complete" }
                : { ...counts, phase: "failed", error: "No application form found on this page." },
        };
    }
    return next;
}
