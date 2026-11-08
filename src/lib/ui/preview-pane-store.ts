"use client";

import { useEffect, useSyncExternalStore } from "react";
import { createPersistedStore } from "./persisted-store";
import { PANE_COOKIE, PANE_DEFAULT, paneCookieValue, type PaneSnapshot } from "./preview-pane-cookie";

export { PANE_DEFAULT };

/** Whether the right-hand preview pane is open (desktop only). */
export const previewPaneStore = createPersistedStore<boolean>({ key: "quikresume.previewPane", storage: "local", initial: false });

export const usePreviewPane = () => previewPaneStore.useValue();
export const setPreviewPane = (open: boolean) => previewPaneStore.set(open);
export const togglePreviewPane = () => previewPaneStore.set(v => !v);

export const PANE_MIN = 360;

/** Preferred pane width in px; the layout clamps it to [PANE_MIN, 50% of the working area]. */
export const previewPaneWidthStore = createPersistedStore<number>({
    key: "quikresume.previewPaneWidth",
    storage: "local",
    initial: PANE_DEFAULT,
    deserialize: s => {
        const n = Number(s);
        return Number.isFinite(n) && n > 0 ? n : PANE_DEFAULT;
    },
});

export const usePreviewPaneWidth = () => previewPaneWidthStore.useValue();
export const setPreviewPaneWidth = (px: number) => previewPaneWidthStore.set(Math.round(px));

/** The pane state, hydrating from the server's cookie snapshot (lib/ui/preview-pane-cookie.ts) instead of the store defaults. */
export function usePaneState(server: PaneSnapshot): PaneSnapshot {
    const open = useSyncExternalStore(previewPaneStore.subscribe, previewPaneStore.get, () => server.open);
    const width = useSyncExternalStore(previewPaneWidthStore.subscribe, previewPaneWidthStore.get, () => server.width);
    useEffect(() => {
        document.cookie = `${PANE_COOKIE}=${paneCookieValue({ open, width })}; path=/; max-age=31536000; samesite=lax`;
    }, [open, width]);
    return { open, width };
}
