"use client";

import { createPersistedStore } from "./persisted-store";

/** Whether the right-hand preview pane is open (desktop only). */
export const previewPaneStore = createPersistedStore<boolean>({ key: "quikresume.previewPane", storage: "local", initial: false });

export const usePreviewPane = () => previewPaneStore.useValue();
export const setPreviewPane = (open: boolean) => previewPaneStore.set(open);
export const togglePreviewPane = () => previewPaneStore.set(v => !v);

export const PANE_MIN = 360;
export const PANE_DEFAULT = 440;

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
