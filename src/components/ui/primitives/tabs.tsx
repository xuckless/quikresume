"use client";

import React, { useId, useRef } from "react";
import { m } from "motion/react";
import { useMotionPresets } from "@/lib/ui/motion";
import { cn } from "@/lib/cn";
import { FOCUS_RING } from "./button";

export interface TabItem<T extends string> {
    value: T;
    label: string;
    count?: number;
}

interface TabsProps<T extends string> {
    items: TabItem<T>[];
    value: T;
    onChange: (value: T) => void;
    className?: string;
    "aria-label"?: string;
}

/** Underline tabs. Scrolls horizontally when it overflows; arrow keys move between tabs. */
export function Tabs<T extends string>({ items, value, onChange, className, "aria-label": ariaLabel }: TabsProps<T>) {
    const listRef = useRef<HTMLDivElement>(null);
    // The underline is one element that slides between tabs.
    const underlineId = useId();
    const motionT = useMotionPresets();

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        e.preventDefault();
        const i = items.findIndex(t => t.value === value);
        const next = items[(i + (e.key === "ArrowRight" ? 1 : items.length - 1)) % items.length];
        if (!next) return;
        onChange(next.value);
        const el = listRef.current?.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`);
        el?.focus();
        el?.scrollIntoView({ inline: "nearest", block: "nearest" });
    };

    return (
        <div ref={listRef} role="tablist" aria-label={ariaLabel} onKeyDown={onKeyDown} className={cn("no-scrollbar -mb-px flex items-end gap-1 overflow-x-auto", className)}>
            {items.map(t => {
                const active = t.value === value;
                return (
                    <button
                        key={t.value}
                        type="button"
                        role="tab"
                        data-value={t.value}
                        aria-selected={active}
                        tabIndex={active ? 0 : -1}
                        onClick={() => onChange(t.value)}
                        className={cn(
                            "press relative flex h-9 shrink-0 items-center gap-1.5 rounded-t-md px-2.5 text-13 whitespace-nowrap",
                            active ? "text-fg font-medium" : "text-fg-muted hover:text-fg",
                            FOCUS_RING,
                        )}
                    >
                        {t.label}
                        {t.count !== undefined && (
                            <span className={cn("rounded-sm px-1 text-xs tabular-nums", active ? "bg-surface-muted text-fg-muted" : "text-fg-subtle")}>{t.count}</span>
                        )}
                        {active && <m.span layoutId={underlineId} aria-hidden className="absolute inset-x-1.5 -bottom-px h-0.5 rounded-full bg-accent" transition={motionT.move} />}
                    </button>
                );
            })}
        </div>
    );
}
