"use client";

import { createPersistedStore } from "./persisted-store";

/** Whether the editor shows layout controls (page, section spacing, per-item overrides). */
const store = createPersistedStore<boolean>({ key: "quikresume.advancedLayout", storage: "local", initial: false });

export const useAdvancedLayout = () => store.useValue();
export const setAdvancedLayout = (on: boolean) => store.set(on);
