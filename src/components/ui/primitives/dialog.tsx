"use client";

import React, { useEffect, useId, useRef } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./button";

interface DialogProps {
    open: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
    /** "lg": wide, scrolling body with a pinned footer (multi-step flows). */
    size?: "md" | "lg";
    /** Optional line under the title. */
    description?: React.ReactNode;
    className?: string;
}

/**
 * Points the dialog's transform-origin at the control that opened it, so it grows out of that control
 * (from scale 0.95, globals.css `dialog.motion-pop`) and shrinks back into it on close. Without a usable
 * trigger (gone, hidden, or opened programmatically) the origin is left alone: the centre on open, the
 * last aim on close.
 */
function aimAtTrigger(dialog: HTMLDialogElement, trigger: Element | null) {
    if (!(trigger instanceof HTMLElement) || trigger === document.body || !trigger.isConnected) return;
    const t = trigger.getBoundingClientRect();
    if (t.width === 0 && t.height === 0) return;
    // The rect may be mid-transform (scaled about the current origin); take the layout box instead: the
    // dialog is centred, so its untransformed box shares the centre of the scaled one only when the origin
    // is the centre, which is why the origin is reset before every open.
    const d = dialog.getBoundingClientRect();
    const left = d.left + d.width / 2 - dialog.offsetWidth / 2;
    const top = d.top + d.height / 2 - dialog.offsetHeight / 2;
    dialog.style.setProperty("--origin", `${Math.round(t.left + t.width / 2 - left)}px ${Math.round(t.top + t.height / 2 - top)}px`);
}

/**
 * Modal on the native <dialog>: focus trap, scroll lock and Escape come for free.
 *
 * Motion (rules 10-12, 15): opens out of the control that had focus (the trigger) from scale 0.95, ease-out,
 * 200 ms; closes back into it (re-aimed if the trigger moved), ease-in, 160 ms. The backdrop fades with it.
 */
export function Dialog({ open, onClose, title, children, footer, size = "md", description, className }: DialogProps) {
    const ref = useRef<HTMLDialogElement>(null);
    const trigger = useRef<Element | null>(null);
    const titleId = useId();

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        if (open && !el.open) {
            // Captured before showModal moves focus: the control that opened the dialog.
            trigger.current = document.activeElement;
            el.style.removeProperty("--origin");
            el.showModal();
            aimAtTrigger(el, trigger.current);
        } else if (!open && el.open) {
            aimAtTrigger(el, trigger.current);
            el.close();
        }
    }, [open]);

    return (
        <dialog
            ref={ref}
            onCancel={e => { e.preventDefault(); onClose(); }}
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}
            className={cn(
                "motion-pop m-auto w-[calc(100%-2rem)] rounded-lg border border-border bg-surface p-0 text-fg shadow-sm",
                size === "lg" ? "max-w-4xl" : "max-w-md",
                className,
            )}
            aria-labelledby={titleId}
        >
            {size === "lg" ? (
                <div className="flex max-h-[88dvh] flex-col">
                    <div className="border-b border-border px-6 py-4">
                        <h2 id={titleId} className="text-base font-semibold">{title}</h2>
                        {description && <div className="mt-0.5 text-13 text-fg-muted">{description}</div>}
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 text-sm">{children}</div>
                    {footer && <div className="flex flex-col-reverse gap-2 border-t border-border px-6 py-3 sm:flex-row sm:items-center sm:justify-end">{footer}</div>}
                </div>
            ) : (
                <div className="p-6">
                    <h2 id={titleId} className="text-base font-semibold">{title}</h2>
                    {description && <div className="mt-0.5 text-13 text-fg-muted">{description}</div>}
                    <div className="mt-2 space-y-2 text-sm text-fg-muted">{children}</div>
                    {footer && <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>}
                </div>
            )}
        </dialog>
    );
}

interface ConfirmDialogProps {
    open: boolean;
    title: string;
    children: React.ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
    busy?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

export function ConfirmDialog({ open, title, children, confirmLabel = "Continue", cancelLabel = "Cancel", danger, busy, onConfirm, onCancel }: ConfirmDialogProps) {
    return (
        <Dialog
            open={open}
            onClose={() => { if (!busy) onCancel(); }}
            title={title}
            footer={
                <>
                    <Button variant="secondary" onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
                    <Button variant="primary" onClick={onConfirm} loading={busy} className={danger ? "bg-danger hover:bg-danger/90" : undefined}>{confirmLabel}</Button>
                </>
            }
        >
            {children}
        </Dialog>
    );
}
