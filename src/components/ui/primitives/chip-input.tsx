"use client";

import React, { useState } from "react";
import { cn } from "@/lib/cn";
import { X } from "./icons";
import { FOCUS_RING } from "./button";

/** A short list of free-text values: Enter or comma adds, Backspace on an empty input removes the last one. */
export function ChipInput({ id, values, onChange, placeholder, max = 10, className, "aria-describedby": describedBy }: {
    id: string;
    values: string[];
    onChange: (values: string[]) => void;
    placeholder?: string;
    max?: number;
    className?: string;
    "aria-describedby"?: string;
}) {
    const [text, setText] = useState("");
    const full = values.length >= max;

    const add = (raw: string) => {
        const parts = raw.split(",").map(s => s.trim()).filter(Boolean);
        if (parts.length === 0) return;
        const seen = new Set(values.map(v => v.toLowerCase()));
        const next = [...values];
        for (const p of parts) {
            if (next.length >= max || seen.has(p.toLowerCase())) continue;
            seen.add(p.toLowerCase());
            next.push(p.slice(0, 80));
        }
        onChange(next);
        setText("");
    };

    return (
        <div className={cn("flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 transition-colors hover:border-border-strong focus-within:border-fg", className)}>
            {values.map(v => (
                <span key={v} className="inline-flex h-6 items-center gap-1 rounded-sm bg-surface-muted pl-2 pr-1 text-13 text-fg">
                    {v}
                    <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter(x => x !== v))} className={cn("press flex size-4 items-center justify-center rounded-sm text-fg-subtle hover:text-fg", FOCUS_RING)}>
                        <X className="size-3" aria-hidden />
                    </button>
                </span>
            ))}
            <input
                id={id}
                value={text}
                disabled={full}
                aria-describedby={describedBy}
                placeholder={full ? "" : values.length === 0 ? placeholder : "Add another…"}
                onChange={e => (e.target.value.includes(",") ? add(e.target.value) : setText(e.target.value))}
                onKeyDown={e => {
                    if (e.key === "Enter") { e.preventDefault(); add(text); }
                    else if (e.key === "Backspace" && !text && values.length > 0) onChange(values.slice(0, -1));
                }}
                onBlur={() => add(text)}
                className="h-7 min-w-[8rem] flex-1 bg-transparent px-1 text-sm text-fg placeholder:text-fg-subtle focus:outline-none disabled:hidden"
            />
        </div>
    );
}
