"use client";

// Light / dark / system. Persisted in localStorage under the key the blocking script in
// src/app/layout.tsx reads, so a reload paints the right theme before React starts.

import { useEffect } from "react";
import { createPersistedStore } from "./persisted-store";

export type ThemeChoice = "light" | "dark" | "system";

export const themeStore = createPersistedStore<ThemeChoice>({
    key: "quikresume.theme",
    storage: "local",
    initial: "system",
    deserialize: s => {
        const v = JSON.parse(s);
        return v === "light" || v === "dark" ? v : "system";
    },
});

const prefersDark = () => typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;

function apply(choice: ThemeChoice) {
    const dark = choice === "dark" || (choice === "system" && prefersDark());
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
}

export function setTheme(choice: ThemeChoice) {
    themeStore.set(choice);
    apply(choice);
}

/** Current choice; also keeps `data-theme` following the OS while the choice is "system". */
export function useTheme(): ThemeChoice {
    const choice = themeStore.useValue();
    useEffect(() => {
        if (choice !== "system") return;
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        const onChange = () => apply("system");
        mq.addEventListener("change", onChange);
        return () => mq.removeEventListener("change", onChange);
    }, [choice]);
    return choice;
}
