"use client";

// JS half of the motion system. globals.css "Motion system" holds the CSS half with the same values;
// test/motion-tokens.test.ts fails if the two drift apart. Components take numbers from here, never inline.
//
// Entrances ease-out, moves ease-in-out, exits ease-in and 20% shorter, popovers 150-250 ms from scale 0.95,
// pressables 0.97, knobs stretch 12%, staggers 30 ms, no overshoot or bounce on everyday UI.

import { useReducedMotion, type Transition } from "motion/react";

export const EASE_OUT = [0.23, 1, 0.32, 1] as const;
export const EASE_IN = [0.55, 0, 1, 0.45] as const;
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;

const bezier = (e: readonly number[]) => `cubic-bezier(${e.join(", ")})`;

/** The same curves as CSS strings, for the Web Animations API and inline `transition` styles. */
export const CSS_EASE = {
    out: bezier(EASE_OUT),
    in: bezier(EASE_IN),
    inOut: bezier(EASE_IN_OUT),
} as const;

/** Exits are this share of their entrance (20% shorter). */
export const EXIT_RATIO = 0.8;

/** Durations in ms; every key is a `--dur-<kebab-key>` token in globals.css. */
export const DUR = {
    hover: 150,
    press: 120,
    pop: 200,
    popExit: 160,
    swap: 180,
    swapExit: 144,
    move: 240,
    reveal: 220,
    revealExit: 176,
    drawer: 260,
    drawerExit: 208,
    arc: 420,
    pulse: 520,
    score: 420,
    scoreDraw: 600,
    theme: 480,
} as const;

/** Delay between list rows / settling details (`--stagger`), and the row index it stops growing at. */
export const STAGGER = 30;
export const STAGGER_CAP = 12;
/** Pressed scale (`--scale-press`), popover start scale (`--scale-pop`), knob stretch (`--knob-stretch`). */
export const SCALE_PRESS = 0.97;
export const SCALE_POP = 0.95;
export const KNOB_STRETCH = 1.12;

/** Delay in seconds for the i-th row of a JS-animated list (same cap as the CSS `rise-in`). */
export function staggerDelay(index: number): number {
    return (Math.min(Math.max(0, index), STAGGER_CAP) * STAGGER) / 1000;
}

/** Distance (px) over which dragging past a bound gives way; the give approaches this asymptotically. */
export const RUBBER_RANGE = 120;
/**
 * Rubber band: how far something follows the pointer when dragged `over` px past a bound. Starts 1:1-ish
 * and resists more the further it goes, never exceeding RUBBER_RANGE. Release eases it back (a move).
 */
export function rubberBand(over: number, range = RUBBER_RANGE): number {
    if (over <= 0) return 0;
    return range * (1 - 1 / ((over / range) * 0.55 + 1));
}

/** Arcs: the control point is lifted by this share of the horizontal travel, at most ARC_MAX_LIFT px. */
export const ARC_LIFT = 0.25;
export const ARC_MAX_LIFT = 90;

const s = (ms: number) => ms / 1000;

const PRESETS = {
    /** Something sliding to a new place (tab underline, segmented thumb, nav pill, layoutId moves). */
    move: { duration: s(DUR.move), ease: EASE_IN_OUT },
    /** Popovers, menus, dialogs appearing; and their exit. */
    pop: { duration: s(DUR.pop), ease: EASE_OUT },
    popExit: { duration: s(DUR.popExit), ease: EASE_IN },
    /** An icon or label replaced in place (crossfade + blur). */
    swap: { duration: s(DUR.swap), ease: EASE_OUT },
    swapExit: { duration: s(DUR.swapExit), ease: EASE_IN },
    /** A view body replaced: old and new overlap. */
    view: { duration: s(DUR.pop), ease: EASE_OUT },
    viewExit: { duration: s(DUR.popExit), ease: EASE_IN },
    /** Rows and details arriving (pair with `staggerDelay(i)`); and leaving. */
    reveal: { duration: s(DUR.reveal), ease: EASE_OUT },
    revealExit: { duration: s(DUR.revealExit), ease: EASE_IN },
} satisfies Record<string, Transition>;

export type MotionPreset = keyof typeof PRESETS;

/** The non-hook presets, for MotionConfig's default and code outside components. */
export const MOTION_PRESETS: Readonly<Record<MotionPreset, Transition>> = PRESETS;

export const INSTANT: Transition = { duration: 0 };

const INSTANT_PRESETS = Object.fromEntries(Object.keys(PRESETS).map(k => [k, INSTANT])) as Record<MotionPreset, Transition>;

/** Transition presets; all instant when the OS asks for reduced motion (the app turns animation off then). */
export function useMotionPresets(): Record<MotionPreset, Transition> {
    const reduce = useReducedMotion();
    return reduce ? INSTANT_PRESETS : PRESETS;
}

/** True when the OS asks for reduced motion, for code outside React (WAAPI, rAF loops). */
export function prefersReducedMotion(): boolean {
    return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
