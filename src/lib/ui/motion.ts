"use client";

// JS half of the motion system (globals.css "Motion system" holds the CSS half, same values).
// Entrances ease-out, moves ease-in-out, exits ease-in and 20% shorter, no overshoot on everyday UI.

import { useReducedMotion, type Transition } from "motion/react";

export const EASE_OUT = [0.23, 1, 0.32, 1] as const;
export const EASE_IN = [0.55, 0, 1, 0.45] as const;
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;

const PRESETS = {
    /** Something sliding to a new place (tab underline, segmented thumb, nav pill). */
    move: { duration: 0.24, ease: EASE_IN_OUT },
    /** Popovers, menus, dialogs appearing. */
    pop: { duration: 0.2, ease: EASE_OUT },
    popExit: { duration: 0.16, ease: EASE_IN },
    /** An icon or label replaced in place (crossfade + blur). */
    swap: { duration: 0.18, ease: EASE_OUT },
    swapExit: { duration: 0.144, ease: EASE_IN },
    /** A view body replaced: old and new overlap. */
    view: { duration: 0.2, ease: EASE_OUT },
    viewExit: { duration: 0.16, ease: EASE_IN },
} satisfies Record<string, Transition>;

export type MotionPreset = keyof typeof PRESETS;

const INSTANT: Transition = { duration: 0 };

/** Transition presets; all instant when the OS asks for reduced motion (the app turns animation off then). */
export function useMotionPresets(): Record<MotionPreset, Transition> {
    const reduce = useReducedMotion();
    if (!reduce) return PRESETS;
    return Object.fromEntries(Object.keys(PRESETS).map(k => [k, INSTANT])) as Record<MotionPreset, Transition>;
}
