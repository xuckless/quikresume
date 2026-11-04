"use client";

import React, { startTransition, useOptimistic, useState } from "react";
import { useFormStatus } from "react-dom";
import { cn } from "@/lib/cn";
import type { Tag } from "@/lib/tags/types";
import { toggleHidden, type SubItem } from "@/lib/sub-items";
import { SubItemList } from "@/components/ui/sub-item-toggles";
import { expansion, useExpandedIds } from "@/lib/ui/expansion-store";
import { ExpandableRow } from "@/components/ui/primitives/expandable-row";
import { Switch } from "@/components/ui/primitives/switch";
import { TagChip } from "@/components/ui/primitives/badge";
import { Button } from "@/components/ui/primitives/button";
import { ConfirmDialog } from "@/components/ui/primitives/dialog";
import type { ResumeData, ResumeListKey } from "@/types/schema";
import type { ItemReview, ReviewSuggestion } from "@/lib/review/types";
import { applySuggestionFormData, visibleSuggestions } from "@/lib/review/apply";
import { fieldSpec } from "@/lib/review/content";
import { dismissReviewSuggestion } from "@/app/actions/review-actions";
import { kickReviews, useReviewRunState } from "@/lib/ui/review-runner";
import { ScoreBadge } from "@/components/ui/review/score-badge";
import { ReviewPanel } from "@/components/ui/review/review-panel";
import { Trash2 } from "@/components/ui/primitives/icons";

export type ServerAction = (id: string, formData: FormData) => Promise<void>;

export const ACTIVE_LABEL = {
    experience: "Currently here",
    education: "Currently enrolled",
    project: "Ongoing",
    volunteering: "Currently volunteering",
    custom: "Ongoing",
} as const;
export type ActiveType = keyof typeof ACTIVE_LABEL;

export interface LibraryRowProps {
    id: string;
    title: string;
    subtitle?: string;
    /** Right-aligned meta (date range, year). */
    meta?: string;
    isSelected: boolean;
    /** Present only for dated sections. */
    active?: { isActive: boolean; type: ActiveType };
    /** Shown in the expanded body only; the collapsed row stays minimal. */
    tags?: Tag[];
    usedBy?: string[];
    onUpdate: ServerAction;
    onDelete: (id: string) => Promise<void>;
    /** A server action failed (the optimistic change has already reverted). */
    onError: (message: string) => void;
    /** Expanded content (bullets, details). */
    children?: React.ReactNode;
    /** AI coach review of this item (absent while the editor model has no matching item). */
    coach?: {
        target: ResumeListKey;
        /** Editor-model item: the text suggestions are matched and applied against. */
        item: ResumeData[ResumeListKey][number];
        review: ItemReview | null;
        stale: boolean;
        briefOutdated: boolean;
        onReviewed: () => void;
    };
    /** Sortable wiring (drag handle, row element, transform). */
    handle?: React.ReactNode;
    rowRef?: React.Ref<HTMLLIElement & HTMLDivElement>;
    style?: React.CSSProperties;
}

export function LibraryRow({ id, title, subtitle, meta, isSelected, active, tags = [], usedBy = [], onUpdate, onDelete, onError, coach, children, handle, rowRef, style }: LibraryRowProps) {
    const open = useExpandedIds().has(id);
    const runState = useReviewRunState();
    // Accepted / dismissed suggestions disappear at once; revalidation brings the saved state.
    const [hiddenSuggestions, hideSuggestion] = useOptimistic(new Set<string>(), (prev: Set<string>, sid: string) => new Set(prev).add(sid));
    const suggestions = coach ? visibleSuggestions(coach.target, coach.item, coach.review).filter(s => !hiddenSuggestions.has(s.id)) : [];

    const accept = (s: ReviewSuggestion) => {
        if (!coach) return;
        const fd = applySuggestionFormData(coach.target, coach.item, s);
        if (!fd) return;
        startTransition(async () => {
            hideSuggestion(s.id);
            try {
                await onUpdate(id, fd);
            } catch (err) {
                console.error("[library] accept failed:", err);
                onError(`Couldn't apply the suggestion to "${title || "this item"}". Try again.`);
            }
        });
    };
    const dismiss = (s: ReviewSuggestion) => {
        if (!coach) return;
        startTransition(async () => {
            hideSuggestion(s.id);
            try {
                await dismissReviewSuggestion(coach.target, id, s.id);
            } catch (err) {
                console.error("[library] dismiss failed:", err);
                onError("Couldn't dismiss the suggestion. Try again.");
            }
        });
    };
    const reReview = () => kickReviews({ ids: [id], onDone: r => { if (r.reviewed > 0) coach?.onReviewed(); } });
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const name = title || "Untitled";

    /** Form action that reports a failure instead of silently reverting. */
    const update = (failure: string) => async (fd: FormData) => {
        try {
            await onUpdate(id, fd);
        } catch (err) {
            console.error("[library] update failed:", err);
            onError(failure);
        }
    };

    const doDelete = async () => {
        setDeleting(true);
        try {
            await onDelete(id);
            setConfirmDelete(false);
        } catch (err) {
            console.error("[library] delete failed:", err);
            onError(`Couldn't delete "${name}". Try again.`);
            setConfirmDelete(false);
        } finally {
            setDeleting(false);
        }
    };

    const summary = (
        <div className="flex min-w-0 items-center gap-3">
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-baseline gap-2">
                    <span className={cn("truncate text-sm font-medium", isSelected ? "text-fg" : "text-fg-muted")}>{title || <span className="text-fg-subtle">Untitled</span>}</span>
                    {subtitle && <span className="hidden truncate text-13 text-fg-muted md:inline">{subtitle}</span>}
                </div>
                {subtitle && <div className="truncate text-13 text-fg-muted md:hidden">{subtitle}</div>}
                {meta && <div className="text-xs text-fg-subtle md:hidden">{meta}</div>}
            </div>
            {coach?.review && <ScoreBadge review={coach.review} outdated={coach.stale} className="hidden shrink-0 sm:inline-flex" />}
            {meta && <span className="hidden w-32 shrink-0 text-right text-13 tabular-nums text-fg-subtle md:inline">{meta}</span>}
        </div>
    );

    const controls = (
        <>
            {active?.isActive && <span title={ACTIVE_LABEL[active.type]} aria-label={ACTIVE_LABEL[active.type]} className="size-1.5 rounded-full bg-success" />}
            <form action={update(`Couldn't ${isSelected ? "exclude" : "include"} "${name}". Try again.`)} className="flex">
                <input type="hidden" name="isSelected" value={(!isSelected).toString()} />
                <PendingSwitch checked={isSelected} label={isSelected ? "Included on résumé" : "Not on résumé"} />
            </form>
        </>
    );

    return (
        <ExpandableRow id={`row-${id}`} open={open} onToggle={() => expansion.toggle(id)} summary={summary} controls={controls} muted={!isSelected} leading={handle} rowRef={rowRef} style={style}>
            <div className="space-y-3 text-13">
                {children}
                {coach && (
                    <ReviewPanel
                        review={coach.review}
                        suggestions={suggestions}
                        stale={coach.stale}
                        briefOutdated={coach.briefOutdated}
                        running={runState.running && (runState.ids.includes(id) || (coach.stale && runState.ids.length === 0))}
                        fieldLabel={field => fieldSpec(coach.target, field)?.label ?? field}
                        onAccept={accept}
                        onDismiss={dismiss}
                        onReReview={reReview}
                    />
                )}
                {tags.length > 0 && (
                    // Tags drive Job Match; they stay out of the way unless asked for.
                    <details className="group/skills text-xs">
                        <summary className="cursor-pointer select-none text-fg-subtle hover:text-fg-muted">Skills detected ({tags.length})</summary>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                            {tags.map(t => <TagChip key={t.name} tag={t} />)}
                        </div>
                    </details>
                )}
                {usedBy.length > 0 && <p className="text-xs text-fg-subtle">Used in {usedBy.join(", ")}</p>}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                    {active && (
                        <form action={update(`Couldn't update "${name}". Try again.`)}>
                            <input type="hidden" name="isActive" value={(!active.isActive).toString()} />
                            <PendingButton>{active.isActive ? `${ACTIVE_LABEL[active.type]} · mark finished` : `Mark as ${ACTIVE_LABEL[active.type].toLowerCase()}`}</PendingButton>
                        </form>
                    )}
                    <Button size="sm" variant="danger" icon={Trash2} className="ml-auto" onClick={() => setConfirmDelete(true)}>Delete</Button>
                </div>
                <ConfirmDialog
                    open={confirmDelete}
                    title={`Delete "${name}"?`}
                    confirmLabel="Delete"
                    danger
                    busy={deleting}
                    onCancel={() => setConfirmDelete(false)}
                    onConfirm={() => void doDelete()}
                >
                    <p>It is removed from your library for good.</p>
                    {usedBy.length > 0 && (
                        <>
                            <p>{usedBy.length === 1 ? "This saved variant includes it" : `These ${usedBy.length} saved variants include it`} and will no longer show it:</p>
                            <ul className="ml-5 list-disc font-medium text-fg">{usedBy.map(v => <li key={v}>{v}</li>)}</ul>
                        </>
                    )}
                </ConfirmDialog>
            </div>
        </ExpandableRow>
    );
}

function PendingSwitch({ checked, label }: { checked: boolean; label: string }) {
    const { pending } = useFormStatus();
    return <Switch type="submit" checked={checked} pending={pending} label={label} />;
}

function PendingButton({ children }: { children: React.ReactNode }) {
    const { pending } = useFormStatus();
    return <Button type="submit" size="sm" variant="secondary" loading={pending}>{children}</Button>;
}

/**
 * Per-bullet / per-skill switches that save straight to Firestore. The list
 * flips optimistically; revalidation brings the persisted `hidden` back.
 */
export function SubItemToggles({ id, entries, hidden, onUpdate, onError, variant }: { id: string; entries: SubItem[]; hidden: string[]; onUpdate: ServerAction; onError: (message: string) => void; variant: "bullets" | "chips" }) {
    const [optimistic, setOptimistic] = useOptimistic(hidden);
    const toggle = (key: string) => {
        const next = toggleHidden(optimistic, key);
        startTransition(async () => {
            setOptimistic(next);
            const fd = new FormData();
            fd.set("hidden", JSON.stringify(next));
            try {
                await onUpdate(id, fd);
            } catch (err) {
                console.error("[library] toggle failed:", err);
                onError(`Couldn't ${variant === "bullets" ? "switch that bullet" : "switch that skill"}. Try again.`);
            }
        });
    };
    return <SubItemList idPrefix={`lib-${id}`} entries={entries} hidden={optimistic} onToggle={toggle} variant={variant} />;
}

export function Detail({ label, value }: { label: string; value?: string | null }) {
    if (!value) return null;
    return (
        <span className="inline-flex items-center gap-1.5 rounded-sm bg-surface-muted px-1.5 py-0.5 text-xs">
            <span className="text-fg-subtle">{label}</span>
            <span className="font-medium text-fg">{value}</span>
        </span>
    );
}
