"use client";

import React from "react";
import { cn } from "@/lib/cn";
import { IconButton } from "./button";
import { X } from "./icons";

export type NoticeTone = "success" | "warning" | "danger";

const TONE: Record<NoticeTone, string> = {
    success: "border-success-border bg-success-bg text-success",
    warning: "border-warning-border bg-warning-bg text-warning",
    danger: "border-danger-border bg-danger-bg text-danger",
};

export function NoticeBanner({ tone, children, onDismiss, className }: { tone: NoticeTone; children: React.ReactNode; onDismiss?: () => void; className?: string }) {
    return (
        <div role={tone === "danger" ? "alert" : "status"} className={cn("flex items-start gap-3 rounded-md border px-3 py-2 text-13", tone === "success" ? "notice-in-success" : "rise-in", TONE[tone], className)}>
            <div className="min-w-0 flex-1 py-1">{children}</div>
            {onDismiss && <IconButton icon={X} aria-label="Dismiss" size="sm" onClick={onDismiss} className="-mr-1.5 -my-1 text-current hover:bg-black/5 hover:text-current" />}
        </div>
    );
}
