"use client";

import React from "react";
import { cn } from "@/lib/cn";
import { FOCUS_RING } from "./button";

const CONTROL = cn(
    "w-full bg-surface text-fg border border-border rounded-md px-3 text-sm placeholder:text-fg-subtle transition-colors",
    "hover:border-border-strong focus:border-fg disabled:opacity-50 disabled:bg-surface-muted",
    "focus:outline-none",
);

export function Label({ children, htmlFor, className }: { children: React.ReactNode; htmlFor?: string; className?: string }) {
    return (
        <label htmlFor={htmlFor} className={cn("block text-13 font-medium text-fg-muted mb-1.5", className)}>
            {children}
        </label>
    );
}

export function Input({ className, ...props }: React.ComponentProps<"input">) {
    return <input {...props} className={cn(CONTROL, "h-9", className)} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
    return <textarea {...props} className={cn(CONTROL, "py-2 resize-y min-h-[2.25rem] leading-relaxed", className)} />;
}

export function Select({ className, selectClassName, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { selectClassName?: string }) {
    return (
        <div className={cn("relative", className)}>
            <select {...props} className={cn(CONTROL, "h-9 appearance-none pr-8", selectClassName)}>
                {children}
            </select>
            <svg aria-hidden viewBox="0 0 24 24" className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
        </div>
    );
}

/** Label + control + optional hint/error, stacked. */
export function Field({ label, htmlFor, hint, warning, error, children, className }: { label: string; htmlFor?: string; hint?: string; warning?: string; error?: string; children: React.ReactNode; className?: string }) {
    return (
        <div className={className}>
            <Label htmlFor={htmlFor}>{label}</Label>
            {children}
            {error ? <p className="mt-1 text-13 text-danger">{error}</p>
                : warning ? <p className="mt-1 text-13 text-warning">{warning}</p>
                : hint ? <p className="mt-1 text-13 text-fg-subtle">{hint}</p> : null}
        </div>
    );
}

export function Checkbox({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
    return <input type="checkbox" {...props} className={cn("press size-4 shrink-0 rounded-sm accent-accent cursor-pointer disabled:cursor-not-allowed", FOCUS_RING, className)} />;
}
