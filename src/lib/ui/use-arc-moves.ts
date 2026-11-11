"use client";

// Cards that change column travel there on an arc instead of jumping (FLIP with the Web Animations API).
// After each render where a card's place changed, it is drawn back at its old position and animated along a
// quadratic curve to the new one, ease-in-out. The curve is lifted by the horizontal travel only, so a card
// that just shifts up or down inside its column slides straight. A card dropped by drag starts from its drop
// point (`dropped`), so nothing tweens while it is held. Skipped entirely when the OS asks for reduced motion.
//
// Positions are kept relative to the container (including its own scroll), so scrolling the page or the board
// between two renders never makes cards fly.

import { useLayoutEffect, useRef } from "react";
import { ARC_LIFT, ARC_MAX_LIFT, CSS_EASE, DUR, prefersReducedMotion } from "./motion";

type Point = { x: number; y: number };

const STEPS = 16;

function arcFrames(dx: number, dy: number): Keyframe[] {
    // Control point: halfway, lifted (towards the top of the screen) by a share of the sideways distance.
    const lift = Math.min(ARC_MAX_LIFT, Math.abs(dx) * ARC_LIFT);
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
 * `containerRef` holds the cards (each with `data-job-card={id}`, or the attribute named by `attribute`);
 * `signature` changes whenever a card may have moved. Returns a map to record a card's drop position
 * (client coordinates, e.g. `active.rect.current.translated`) before it moves.
 */
export function useArcMoves(containerRef: React.RefObject<HTMLElement | null>, signature: string, attribute = "data-job-card") {
    const last = useRef(new Map<string, Point>());
    const dropped = useRef(new Map<string, Point>());

    useLayoutEffect(() => {
        const root = containerRef.current;
        if (!root) return;
        const reduce = prefersReducedMotion();
        const box = root.getBoundingClientRect();
        const local = (p: Point): Point => ({ x: p.x - box.left + root.scrollLeft, y: p.y - box.top + root.scrollTop });
        const next = new Map<string, Point>();
        root.querySelectorAll<HTMLElement>(`[${attribute}]`).forEach(el => {
            const id = el.getAttribute(attribute)!;
            const r = el.getBoundingClientRect();
            const now = local({ x: r.left, y: r.top });
            next.set(id, now);
            const drop = dropped.current.get(id);
            const from = drop ? local(drop) : last.current.get(id);
            if (!from || reduce) return;
            const dx = from.x - now.x;
            const dy = from.y - now.y;
            if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
            // A remounted card would also play its list entrance; the arc replaces it.
            el.getAnimations().forEach(a => a.cancel());
            el.animate(arcFrames(dx, dy), { duration: DUR.arc, easing: CSS_EASE.inOut });
        });
        dropped.current.clear();
        last.current = next;
    }, [containerRef, signature, attribute]);

    return dropped;
}
