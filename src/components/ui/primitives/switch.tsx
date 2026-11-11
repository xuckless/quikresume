"use client";

import React, { useState } from "react";
import { cn } from "@/lib/cn";
import { FOCUS_RING } from "./button";

interface SwitchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
    checked: boolean;
    /** Omit when the switch submits a form (type="submit"). */
    onChange?: (checked: boolean) => void;
    pending?: boolean;
    label?: string;
}

const OFF_X = 1;
const ON_X = 15;

/**
 * Visual toggle. Renders a <button role="switch">; pass type="submit" to use it
 * as the submit control of a server-action form (the library rows do this).
 *
 * Motion: scales to 0.97 while pressed; the knob moves ease-in-out (240 ms) and stretches 12% mid-travel
 * (globals.css `knob-stretch-*`); the accent colour is revealed through a circular mask growing from the
 * knob's side rather than a flat colour fade. Nothing animates on mount.
 */
export function Switch({ checked, onChange, pending, label, className, type = "button", disabled, ...rest }: SwitchProps) {
    // Animate the knob only after a real change (never on mount / first paint).
    const [prev, setPrev] = useState(checked);
    const [moved, setMoved] = useState(false);
    if (prev !== checked) {
        setPrev(checked);
        setMoved(true);
    }
    const x = checked ? ON_X : OFF_X;

    return (
        <button
            type={type}
            role="switch"
            aria-checked={checked}
            aria-label={label}
            aria-busy={pending || undefined}
            disabled={disabled || pending}
            onClick={onChange ? () => onChange(!checked) : rest.onClick}
            className={cn(
                "press relative inline-flex h-[18px] w-8 shrink-0 items-center overflow-hidden rounded-full border bg-surface-muted",
                checked ? "border-accent" : "border-border-strong",
                // Colour reveal: an accent fill masked by a circle that grows from the knob's position.
                "before:absolute before:inset-0 before:bg-accent before:transition-[clip-path] before:duration-(--dur-move) before:ease-in-out",
                checked ? "before:[clip-path:circle(150%_at_72%_50%)]" : "before:[clip-path:circle(0%_at_28%_50%)]",
                "disabled:opacity-60 disabled:cursor-wait",
                FOCUS_RING,
                className,
            )}
            {...rest}
        >
            <span
                aria-hidden
                className="absolute top-1/2 left-0 z-10 size-3.5 rounded-full bg-surface shadow-sm"
                style={{
                    transform: `translate(${x}px, -50%)`,
                    ["--knob-from" as string]: `${checked ? OFF_X : ON_X}px`,
                    ["--knob-mid" as string]: `${(OFF_X + ON_X) / 2}px`,
                    ["--knob-to" as string]: `${x}px`,
                    animation: moved ? `${checked ? "knob-stretch-on" : "knob-stretch-off"} var(--dur-move) var(--ease-in-out)` : undefined,
                }}
            />
        </button>
    );
}
