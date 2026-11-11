"use client";

// Wraps the app so `m.*` components animate. The engine (domMax: layout + layoutId) loads lazily, after
// first paint; until then `m.*` render as plain elements. `strict`: a full `motion.*` component inside
// throws in development (it would bundle the engine eagerly); use `m.*`.
//
// The default transition is the `move` preset (ease-in-out, no spring), so an `m.*` or layoutId element
// without its own transition never overshoots. Reduced motion makes every transition instant.

import React from "react";
import { LazyMotion, MotionConfig, useReducedMotion } from "motion/react";
import { INSTANT, MOTION_PRESETS } from "@/lib/ui/motion";

const loadFeatures = () => import("@/lib/ui/motion-features").then(m => m.default);

export function MotionProvider({ children }: { children: React.ReactNode }) {
    const reduce = useReducedMotion();
    return (
        <LazyMotion features={loadFeatures} strict>
            <MotionConfig reducedMotion="user" transition={reduce ? INSTANT : MOTION_PRESETS.move}>{children}</MotionConfig>
        </LazyMotion>
    );
}
