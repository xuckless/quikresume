"use client";

import { createPersistedStore } from "./persisted-store";

/** The Library's "Tell us about you" banner was dismissed for this browser session. */
const store = createPersistedStore<boolean>({ key: "quikresume.aboutNudgeDismissed", storage: "session", initial: false });

export const useAboutNudgeDismissed = () => store.useValue();
export const dismissAboutNudge = () => store.set(true);
