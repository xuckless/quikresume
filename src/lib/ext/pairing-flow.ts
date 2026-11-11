// src/lib/ext/pairing-flow.ts
// The pairing flow on /dashboard/extension, as a pure reducer (driven by useReducer in
// components/ui/extension/extension-panel.tsx):
//
//   idle -> issuing a code -> awaiting (code on screen; the extension was asked to pair with it, or the
//   user types it in) -> connected | pairing-failed (the code stays usable) ; issuing can also fail.
//
// Only one code is requested at a time: "issue" is ignored while issuing, and a code or failure only
// applies to the request that is in flight. The caller cancels the request when the phase moves on.

export type ConnectionCode = { code: string; expiresAt: string };
export type PairingMode = "automatic" | "manual";

export type PairingFlow =
    | { phase: "idle" }
    | { phase: "issuing"; mode: PairingMode }
    | { phase: "awaiting"; code: ConnectionCode }
    | { phase: "pairing-failed"; code: ConnectionCode; error: string }
    | { phase: "connected" }
    | { phase: "failed"; error: string };

export type PairingEvent =
    | { type: "issue"; mode: PairingMode }
    | { type: "code"; code: ConnectionCode }
    | { type: "failed"; error: string }
    | { type: "paired"; ok: boolean; error?: string }
    | { type: "dismiss" };

export const idlePairing: PairingFlow = { phase: "idle" };

export function pairingTransition(state: PairingFlow, event: PairingEvent): PairingFlow {
    switch (event.type) {
        case "issue":
            return state.phase === "issuing" ? state : { phase: "issuing", mode: event.mode };
        case "code":
            return state.phase === "issuing" ? { phase: "awaiting", code: event.code } : state;
        case "failed":
            return state.phase === "issuing" ? { phase: "failed", error: event.error } : state;
        case "paired": {
            // The extension also reports pairings the page did not start (e.g. a reload mid-flow).
            if (event.ok) return { phase: "connected" };
            const error = event.error ?? "The extension could not connect. Try the code in its panel.";
            if (state.phase === "awaiting" || state.phase === "pairing-failed") return { phase: "pairing-failed", code: state.code, error };
            return state.phase === "issuing" ? { phase: "failed", error } : state;
        }
        case "dismiss":
            if (state.phase === "issuing") return state;
            return state.phase === "pairing-failed" ? { phase: "awaiting", code: state.code } : idlePairing;
    }
}

/** What this browser's extension answered to the page's ping. */
export type ExtensionDetection =
    | { phase: "checking" }
    | { phase: "missing" }
    | { phase: "found"; version: string; paired: boolean };
