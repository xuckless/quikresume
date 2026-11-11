"use client";

import React, { useId } from "react";
import { m } from "motion/react";
import { cn } from "@/lib/cn";
import { useMotionPresets } from "@/lib/ui/motion";
import { FOCUS_RING } from "./button";

/**
 * Segmented control. Motion: options scale to 0.97 while pressed; the selected thumb slides ease-in-out
 * between options (one layoutId per control instance, so two controls never trade thumbs).
 */
export function Segmented<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; className?: string }) {
    const thumbId = useId();
    const t = useMotionPresets();
    return (
        <div role="radiogroup" className={cn("inline-flex h-8 items-center rounded-md bg-surface-muted p-0.5", className)}>
            {options.map(o => {
                const active = value === o.value;
                return (
                    <button
                        key={o.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => onChange(o.value)}
                        className={cn(
                            "press relative h-7 rounded-[5px] px-2.5 text-13 whitespace-nowrap",
                            active ? "text-fg font-medium" : "text-fg-muted hover:text-fg",
                            FOCUS_RING,
                        )}
                    >
                        {active && <m.span layoutId={thumbId} aria-hidden className="absolute inset-0 rounded-[5px] bg-surface shadow-sm" transition={t.move} />}
                        <span className="relative">{o.label}</span>
                    </button>
                );
            })}
        </div>
    );
}
