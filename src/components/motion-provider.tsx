"use client";

// Wraps the app so `m.*` components animate. The engine (domMax: layout + layoutId) loads lazily, after
// first paint; until then `m.*` render as plain elements. Reduced motion turns animation off entirely.

import React from "react";
import { LazyMotion, MotionConfig } from "motion/react";

const loadFeatures = () => import("@/lib/ui/motion-features").then(m => m.default);

export function MotionProvider({ children }: { children: React.ReactNode }) {
    return (
        <LazyMotion features={loadFeatures} strict>
            <MotionConfig reducedMotion="user">{children}</MotionConfig>
        </LazyMotion>
    );
}
