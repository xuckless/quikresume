"use client";

// Replaces one icon / short label with another in place: the old one blurs and fades out while the new one
// blurs in over it (the two overlap, so there is never an empty frame). Keyed by `swapKey`. The exit is
// ease-in and 20% shorter than the entrance. `appear` also animates the first child (when the Swap itself
// mounts together with something new, e.g. a spinner on a button that had no icon).

import React from "react";
import { AnimatePresence, m } from "motion/react";
import { cn } from "@/lib/cn";
import { useMotionPresets } from "@/lib/ui/motion";

const HIDDEN = { opacity: 0, scale: 0.8, filter: "blur(4px)" };

export function Swap({ swapKey, children, className, appear = false }: { swapKey: string; children: React.ReactNode; className?: string; appear?: boolean }) {
    const t = useMotionPresets();
    return (
        <span className={cn("relative inline-grid place-items-center", className)}>
            <AnimatePresence initial={appear} mode="popLayout">
                <m.span
                    key={swapKey}
                    className="inline-flex items-center justify-center"
                    initial={HIDDEN}
                    animate={{ opacity: 1, scale: 1, filter: "blur(0px)", transition: t.swap }}
                    exit={{ ...HIDDEN, transition: t.swapExit }}
                >
                    {children}
                </m.span>
            </AnimatePresence>
        </span>
    );
}
