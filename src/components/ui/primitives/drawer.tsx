"use client";

import React, { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";

/**
 * Left-anchored off-canvas panel on the native <dialog> (mobile navigation). Motion (globals.css
 * `dialog.motion-drawer`): slides in from the left edge, where its menu button sits, ease-out 260 ms, and back
 * out to it, ease-in 208 ms (20% shorter); the backdrop fades with it.
 */
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
            )}
        >
            <div className="flex h-full flex-col">{children}</div>
        </dialog>
    );
}
