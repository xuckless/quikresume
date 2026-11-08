"use client";

// Cards that change column travel there on an arc instead of jumping (FLIP with the Web Animations API).
// After each render where a card's place changed, it is drawn back at its old position and animated along a
// quadratic curve to the new one, ease-in-out. A card dropped by drag starts from its drop point (`dropped`),
// so nothing tweens while it is held. Skipped entirely when the OS asks for reduced motion.

import { useLayoutEffect, useRef } from "react";

type Point = { x: number; y: number };

const DURATION = 420;
const STEPS = 16;
const EASE_IN_OUT = "cubic-bezier(0.77, 0, 0.175, 1)";

function arcFrames(dx: number, dy: number): Keyframe[] {
    // Control point: halfway, lifted by a share of the distance (an arc, not a straight slide).
    const lift = Math.min(90, Math.hypot(dx, dy) * 0.25);
    const cx = dx / 2;
    const cy = dy / 2 - lift;
    const frames: Keyframe[] = [];
    for (let i = 0; i <= STEPS; i++) {
        const t = i / STEPS;
        const x = (1 - t) * (1 - t) * dx + 2 * (1 - t) * t * cx;
        const y = (1 - t) * (1 - t) * dy + 2 * (1 - t) * t * cy;
        frames.push({ transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`, offset: t });
    }
    return frames;
}

/**
 * `containerRef` holds the cards (each with `data-job-card={id}`); `signature` changes whenever a card may
 * have moved. Returns a map to record a card's drop position (client coordinates) before it moves.
 */
export function useArcMoves(containerRef: React.RefObject<HTMLElement | null>, signature: string) {
    const last = useRef(new Map<string, Point>());
    const dropped = useRef(new Map<string, Point>());

    useLayoutEffect(() => {
        const root = containerRef.current;
        if (!root) return;
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const next = new Map<string, Point>();
        root.querySelectorAll<HTMLElement>("[data-job-card]").forEach(el => {
            const id = el.dataset.jobCard!;
            const r = el.getBoundingClientRect();
            const now = { x: r.left, y: r.top };
            next.set(id, now);
            const from = dropped.current.get(id) ?? last.current.get(id);
            if (!from || reduce) return;
            const dx = from.x - now.x;
            const dy = from.y - now.y;
            if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
            // A remounted card would also play its list entrance; the arc replaces it.
            el.getAnimations().forEach(a => a.cancel());
            el.animate(arcFrames(dx, dy), { duration: DURATION, easing: EASE_IN_OUT });
        });
        dropped.current.clear();
        last.current = next;
    }, [containerRef, signature]);

    return dropped;
}
