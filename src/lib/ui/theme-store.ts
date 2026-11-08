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

/**
 * Switches theme with a reveal: the new colours spread out of the clicked control through a growing circular
 * mask (View Transitions API). Falls back to an instant switch without the API or under reduced motion.
 */
export function setThemeFrom(choice: ThemeChoice, from: { x: number; y: number }) {
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
    if (!doc.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setTheme(choice);
        return;
    }
    const radius = Math.hypot(Math.max(from.x, window.innerWidth - from.x), Math.max(from.y, window.innerHeight - from.y));
    const vt = doc.startViewTransition(() => setTheme(choice));
    vt.ready.then(() => {
        document.documentElement.animate(
            { clipPath: [`circle(0px at ${from.x}px ${from.y}px)`, `circle(${radius}px at ${from.x}px ${from.y}px)`] },
            { duration: 480, easing: "cubic-bezier(0.23, 1, 0.32, 1)", pseudoElement: "::view-transition-new(root)" },
        );
    }).catch(() => { /* transition skipped */ });
}
