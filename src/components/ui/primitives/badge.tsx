import React from "react";
import { cn } from "@/lib/cn";
import { kindMeta, type Tag } from "@/lib/tags/types";

export type BadgeTone = "neutral" | "strong" | "warning" | "danger" | "success";

const TONE: Record<BadgeTone, string> = {
    neutral: "bg-surface-muted text-fg-muted",
    strong: "bg-accent text-accent-fg",
    warning: "bg-warning-bg text-warning",
    danger: "bg-danger-bg text-danger",
    success: "bg-success-bg text-success",
};

export function Badge({ tone = "neutral", size = "sm", className, children, title }: { tone?: BadgeTone; size?: "xs" | "sm"; className?: string; children: React.ReactNode; title?: string }) {
    return (
        <span title={title} className={cn("inline-flex items-center rounded-sm font-medium whitespace-nowrap", size === "xs" ? "h-[18px] px-1.5 text-[11px]" : "h-5 px-1.5 text-xs", TONE[tone], className)}>
            {children}
        </span>
    );
}

/** Smart-tag chip tinted by its kind colour (muted background, readable text). */
export function TagChip({ tag, className }: { tag: Tag; className?: string }) {
    const { color, label } = kindMeta(tag.kind);
    return (
        <span
            title={label}
            className={cn("inline-flex h-5 max-w-[12rem] items-center truncate rounded-sm px-1.5 text-xs font-medium", className)}
            style={{ background: `${color}14`, color: `color-mix(in srgb, ${color} 75%, var(--fg))` }}
        >
            {tag.display}
        </span>
    );
}

/** Small coloured dot used in legends and kind labels. */
export function KindDot({ color, className }: { color: string; className?: string }) {
    return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", className)} style={{ background: color }} />;
}
