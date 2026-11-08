"use client";

import React, { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";

/** Left-anchored off-canvas panel on the native <dialog> (mobile navigation). */
export function Drawer({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: React.ReactNode; label: string }) {
    const ref = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        if (open && !el.open) el.showModal();
        else if (!open && el.open) el.close();
    }, [open]);

    return (
        <dialog
            ref={ref}
            aria-label={label}
            onCancel={e => { e.preventDefault(); onClose(); }}
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}
            className={cn(
                "motion-drawer fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-72 max-w-[85vw] border-r border-border bg-surface p-0 text-fg",
                "backdrop:bg-black/35",
            )}
        >
            <div className="flex h-full flex-col">{children}</div>
        </dialog>
    );
}
