"use client";

import React, { useState } from "react";
import { cn } from "@/lib/cn";
import { IconButton } from "./button";
import { X } from "./icons";

export type NoticeTone = "success" | "warning" | "danger";

const TONE: Record<NoticeTone, string> = {
    success: "border-success-border bg-success-bg text-success",
    warning: "border-warning-border bg-warning-bg text-warning",
    danger: "border-danger-border bg-danger-bg text-danger",
};

/**
 * Inline notice. Motion: rises in (ease-out); a success notice then pulses once to confirm. Dismissing with
 * its X plays the exit (back down, ease-in, 20% shorter) before `onDismiss` runs, so the parent unmounts it
 * after it has gone. A parent that removes it some other way removes it at once.
 */
export function NoticeBanner({ tone, children, onDismiss, className }: { tone: NoticeTone; children: React.ReactNode; onDismiss?: () => void; className?: string }) {
    const [leaving, setLeaving] = useState(false);
    const done = (e: React.AnimationEvent<HTMLDivElement>) => {
        if (!leaving || e.target !== e.currentTarget || e.animationName !== "rise-out") return;
        // If the parent keeps the banner after all, show it again rather than leaving an invisible box.
        setLeaving(false);
        onDismiss?.();
    };
    return (
        <div
            role={tone === "danger" ? "alert" : "status"}
            onAnimationEnd={done}
            className={cn("flex items-start gap-3 rounded-md border px-3 py-2 text-13", leaving ? "rise-out" : tone === "success" ? "notice-in-success" : "rise-in", TONE[tone], className)}
        >
            <div className="min-w-0 flex-1 py-1">{children}</div>
            {onDismiss && <IconButton icon={X} aria-label="Dismiss" size="sm" disabled={leaving} onClick={() => setLeaving(true)} className="-mr-1.5 -my-1 text-current hover:bg-current/10 hover:text-current" />}
        </div>
    );
}
