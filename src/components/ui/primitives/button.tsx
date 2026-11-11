"use client";

import React from "react";
import { cn } from "@/lib/cn";
import { Loader2, type LucideIcon } from "./icons";
import { Swap } from "./swap";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const VARIANT: Record<ButtonVariant, string> = {
    primary: "bg-accent text-accent-fg hover:bg-accent-hover border border-transparent",
    secondary: "bg-surface text-fg border border-border hover:bg-surface-hover hover:border-border-strong",
    ghost: "bg-transparent text-fg-muted border border-transparent hover:bg-surface-hover hover:text-fg",
    danger: "bg-transparent text-danger border border-transparent hover:bg-danger-bg",
};

const SIZE: Record<ButtonSize, string> = {
    sm: "h-8 px-2.5 text-13 gap-1.5 rounded-md",
    md: "h-9 px-3.5 text-sm gap-2 rounded-md",
};

export const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-1 focus-visible:ring-offset-bg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    loading?: boolean;
    icon?: LucideIcon;
    /** True right after the action this button ran succeeded: the button pulses once to confirm (rule 8). */
    succeeded?: boolean;
}

/**
 * Motion: scales to 0.97 while pressed (`press`); the icon and the loading spinner crossfade with a blur
 * (`Swap`), and a spinner on an icon-less button blurs in rather than popping; `succeeded` pulses once.
 */
export function Button({ variant = "secondary", size = "md", loading = false, icon: Icon, succeeded = false, className, children, disabled, type = "button", ...rest }: ButtonProps) {
    return (
        <button
            type={type}
            disabled={disabled || loading}
            className={cn(
                "press inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap select-none",
                "disabled:opacity-50 disabled:pointer-events-none",
                FOCUS_RING,
                VARIANT[variant],
                SIZE[size],
                succeeded && "pulse-success",
                className,
            )}
            {...rest}
        >
            {(loading || Icon) && (
                // Without an icon the Swap mounts with the spinner, so let that first one animate in.
                <Swap swapKey={loading ? "loading" : "icon"} appear={!Icon}>
                    {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : Icon ? <Icon className="size-3.5" aria-hidden /> : null}
                </Swap>
            )}
            {children}
        </button>
    );
}

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    icon: LucideIcon;
    /** Required: icon-only buttons need an accessible name. */
    "aria-label": string;
    variant?: ButtonVariant;
    size?: ButtonSize;
    loading?: boolean;
}

/** Square icon-only button. Changing `icon` (Copy -> Check) crossfades the two with a blur. */
export function IconButton({ icon: Icon, variant = "ghost", size = "sm", loading, className, disabled, type = "button", ...rest }: IconButtonProps) {
    return (
        <button
            type={type}
            disabled={disabled || loading}
            className={cn(
                "press inline-flex shrink-0 items-center justify-center rounded-md",
                "disabled:opacity-50 disabled:pointer-events-none",
                FOCUS_RING,
                VARIANT[variant],
                size === "sm" ? "size-8" : "size-9",
                className,
            )}
            {...rest}
        >
            <Swap swapKey={loading ? "loading" : (Icon.displayName ?? "icon")}>
                {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Icon className="size-4" aria-hidden />}
            </Swap>
        </button>
    );
}
