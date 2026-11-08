// Preview-pane cookie, shared by the server page and the client store (no "use client": the server reads the values).
// The pane preference lives in localStorage; this mirror lets the server render the dashboard with the pane's
// column already in place, so it doesn't appear after hydration and shift the layout under the pointer.

export const PANE_COOKIE = "qr_pane";
export const PANE_DEFAULT = 440;

export interface PaneSnapshot { open: boolean; width: number }

/** Parses `<0|1>.<width>`; anything else is the closed default. */
export function parsePaneCookie(raw: string | undefined): PaneSnapshot {
    const m = /^([01])\.(\d{2,4})$/.exec(raw ?? "");
    return m ? { open: m[1] === "1", width: Number(m[2]) } : { open: false, width: PANE_DEFAULT };
}

export const paneCookieValue = (s: PaneSnapshot) => `${s.open ? 1 : 0}.${Math.round(s.width)}`;
