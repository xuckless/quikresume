// src/components/ui/variants-page.tsx
"use client";

import React, { useState } from "react";
import type { ResumeData } from "@/types/schema";
import type { ResumeVariant } from "@/types/db";
import { createVariant, deleteVariant, duplicateVariant, loadVariant, resnapshotVariant, updateVariant } from "@/app/actions/variant-actions";
import { countItems, missingCount, selectedIds, selectionEquals } from "@/lib/variants";
import { COLLECTION_SECTION, SECTION_LABEL, COLLECTION_NAMES } from "@/lib/sections";
import { cn } from "@/lib/cn";
import { TopBar } from "@/components/ui/primitives/top-bar";
import { Button } from "@/components/ui/primitives/button";
import { Field, Input } from "@/components/ui/primitives/field";
import { Card, CardBody, CardHeader } from "@/components/ui/primitives/card";
import { Badge } from "@/components/ui/primitives/badge";
import { NoticeBanner } from "@/components/ui/primitives/notice-banner";
import { useOperation } from "@/lib/ui/use-operation";
import { EmptyState } from "@/components/ui/primitives/empty-state";
import { ConfirmDialog } from "@/components/ui/primitives/dialog";
import { FOCUS_RING } from "@/components/ui/primitives/button";
import { Layers } from "@/components/ui/primitives/icons";

type VariantAction = "create" | "delete" | `${"load" | "snap" | "rename" | "labels" | "dup"}-${string}`;

interface VariantsPageProps {
    variants: ResumeVariant[];
    loadedVariantId: string | null;
    data: ResumeData;
}

const parseLabels = (s: string) => s.split(",").map(x => x.trim()).filter(Boolean);
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "");

export function VariantsPage({ variants, loadedVariantId, data }: VariantsPageProps) {
    const [query, setQuery] = useState("");
    const [labelFilter, setLabelFilter] = useState<string | null>(null);
    const [newName, setNewName] = useState("");
    const [newLabels, setNewLabels] = useState("");
    // One variant action at a time; the kind names the row so only its buttons spin.
    const operation = useOperation<VariantAction, string | null>();
    const busy = operation.running;
    const error = operation.error;
    const notice = operation.state.status === "succeeded" ? operation.state.result : null;
    const [pendingDelete, setPendingDelete] = useState<ResumeVariant | null>(null);

    const allLabels = [...new Set(variants.flatMap(v => v.labels))].sort();
    const q = query.trim().toLowerCase();
    const shown = variants.filter(v =>
        (!q || v.name.toLowerCase().includes(q) || v.labels.some(l => l.toLowerCase().includes(q))) &&
        (!labelFilter || v.labels.includes(labelFilter)),
    );
    const selectedNow = countItems(selectedIds(data));

    const run = async (key: VariantAction, fn: () => Promise<void | string>, done?: string) => {
        await operation.run(key, async () => (await fn()) ?? done ?? null);
    };

    return (
        <>
            <TopBar
                title="Variants"
                subtitle="Saved selections of your library, one per kind of application. A variant only remembers which items were included."
                actions={<Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search…" className="h-8 w-40 text-13 md:w-56" aria-label="Search variants" />}
            />
            <main className="p-4 pb-16 md:p-6">
                <div className="mx-auto max-w-5xl space-y-4">
                    {error && <NoticeBanner tone="danger" onDismiss={() => operation.reset()}>{error}</NoticeBanner>}
                    {notice && <NoticeBanner tone="success" onDismiss={() => operation.reset()}>{notice}</NoticeBanner>}

                    <Card>
                        <CardHeader title="Save the current selection" hint={`${selectedNow} ${selectedNow === 1 ? "item is" : "items are"} currently included on the dashboard.`} />
                        <CardBody className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
                            <Field label="Name" htmlFor="variant-name">
                                <Input id="variant-name" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Backend roles 2026" />
                            </Field>
                            <Field label="Labels (comma-separated)" htmlFor="variant-labels">
                                <Input id="variant-labels" value={newLabels} onChange={e => setNewLabels(e.target.value)} placeholder="Stripe, fintech" />
                            </Field>
                            <Button
                                variant="primary"
                                disabled={!newName.trim() || selectedNow === 0}
                                loading={busy === "create"}
                                onClick={() => run("create", async () => {
                                    await createVariant({ name: newName, labels: parseLabels(newLabels) });
                                    setNewName("");
                                    setNewLabels("");
                                }, "Variant saved.")}
                            >
                                Save variant
                            </Button>
                        </CardBody>
                    </Card>

                    {allLabels.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs text-fg-subtle">Filter</span>
                            {allLabels.map(l => {
                                const on = labelFilter === l;
                                return (
                                    <button
                                        key={l}
                                        type="button"
                                        aria-pressed={on}
                                        onClick={() => setLabelFilter(on ? null : l)}
                                        className={cn("press h-6 rounded-sm px-2 text-xs font-medium", on ? "bg-accent text-accent-fg" : "bg-surface-muted text-fg-muted hover:text-fg", FOCUS_RING)}
                                    >
                                        {l}
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {variants.length === 0 ? (
                        <EmptyState icon={Layers} title="No variants yet" body="Toggle items on the dashboard, then save the selection here under a name." />
                    ) : (
                        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
                            {shown.map(v => (
                                <VariantRow
                                    key={v.id}
                                    variant={v}
                                    data={data}
                                    loaded={v.id === loadedVariantId}
                                    busy={busy}
                                    onLoad={() => run(`load-${v.id}`, async () => {
                                        const r = await loadVariant(v.id);
                                        return (r.missing > 0 ? `Loaded "${v.name}". ${r.missing} ${r.missing === 1 ? "item" : "items"} it pointed to no longer exist and were dropped.` : `Loaded "${v.name}" into your working selection.`);
                                    })}
                                    onUpdateSelection={() => run(`snap-${v.id}`, () => resnapshotVariant(v.id), `"${v.name}" now matches the current selection.`)}
                                    onRename={(name) => run(`rename-${v.id}`, () => updateVariant(v.id, { name }), `Renamed to "${name.trim()}".`)}
                                    onLabels={(labels) => run(`labels-${v.id}`, () => updateVariant(v.id, { labels }), labels.length ? `Labels on "${v.name}" updated.` : `Labels removed from "${v.name}".`)}
                                    onDuplicate={() => run(`dup-${v.id}`, async () => { await duplicateVariant(v.id); }, "Duplicated.")}
                                    onDelete={() => setPendingDelete(v)}
                                />
                            ))}
                            {shown.length === 0 && <li className="py-8 text-center text-13 text-fg-subtle">Nothing matches.</li>}
                        </ul>
                    )}
                </div>
            </main>

            <ConfirmDialog
                open={pendingDelete !== null}
                title={`Delete "${pendingDelete?.name}"?`}
                confirmLabel="Delete"
                danger
                busy={busy === "delete"}
                onCancel={() => setPendingDelete(null)}
                onConfirm={() => {
                    const v = pendingDelete;
                    if (!v) return;
                    run("delete", async () => { await deleteVariant(v.id); setPendingDelete(null); }, "Variant deleted.");
                }}
            >
                <p>Only the saved selection is removed. Your library items stay untouched.</p>
            </ConfirmDialog>
        </>
    );
}

interface VariantRowProps {
    variant: ResumeVariant;
    data: ResumeData;
    loaded: boolean;
    busy: string | null;
    onLoad: () => void;
    onUpdateSelection: () => void;
    onRename: (name: string) => void;
    onLabels: (labels: string[]) => void;
    onDuplicate: () => void;
    onDelete: () => void;
}

function VariantRow({ variant: v, data, loaded, busy, onLoad, onUpdateSelection, onRename, onLabels, onDuplicate, onDelete }: VariantRowProps) {
    const [editing, setEditing] = useState<"name" | "labels" | null>(null);
    const [draft, setDraft] = useState("");
    const total = countItems(v.items);
    const missing = missingCount(v.items, data);
    const inSync = selectionEquals(data, v.items, v.hidden);
    const isBusy = busy !== null && busy.endsWith(v.id);

    const commit = () => {
        if (editing === "name" && draft.trim() && draft.trim() !== v.name) onRename(draft);
        if (editing === "labels" && parseLabels(draft).join("\n") !== v.labels.join("\n")) onLabels(parseLabels(draft));
        setEditing(null);
    };

    const inlineInput = (placeholder: string, className?: string) => (
        <Input
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(null); }}
            placeholder={placeholder}
            className={cn("h-8 text-13", className)}
        />
    );

    return (
        <li className={cn("flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center", loaded && "bg-surface-muted/60")}>
            <span className={cn("hidden h-10 w-0.5 shrink-0 rounded-full md:block", loaded ? "bg-accent" : "bg-transparent")} aria-hidden />
            <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                    {editing === "name" ? inlineInput("Variant name", "max-w-xs") : (
                        <button type="button" onClick={() => { setDraft(v.name); setEditing("name"); }} className={cn("press truncate rounded-sm text-left text-sm font-medium text-fg hover:underline underline-offset-2", FOCUS_RING)} title="Rename">
                            {v.name}
                        </button>
                    )}
                    {loaded && <Badge tone="strong">{inSync ? "Loaded" : "Loaded · modified"}</Badge>}
                    {editing === "labels" ? inlineInput("comma-separated labels", "w-64") : (
                        <>
                            {v.labels.map(l => <Badge key={l}>{l}</Badge>)}
                            <button type="button" onClick={() => { setDraft(v.labels.join(", ")); setEditing("labels"); }} className={cn("press rounded-sm text-xs text-fg-subtle hover:text-fg", FOCUS_RING)}>
                                {v.labels.length ? "Edit labels" : "+ Add label"}
                            </button>
                        </>
                    )}
                </div>
                <p className="text-xs text-fg-subtle">
                    {total} {total === 1 ? "item" : "items"}
                    {missing > 0 && <span className="text-warning"> · {missing} missing</span>}
                    {v.updatedAt && ` · updated ${fmtDate(v.updatedAt)}`}
                    <span className="text-fg-subtle"> · {COLLECTION_NAMES.filter(c => v.items[c].length > 0).map(c => `${SECTION_LABEL[COLLECTION_SECTION[c]]} ${v.items[c].length}`).join(", ") || "empty selection"}</span>
                </p>
            </div>
            <div className="flex flex-wrap gap-1.5 md:shrink-0">
                <Button size="sm" variant={loaded && inSync ? "secondary" : "primary"} onClick={onLoad} loading={busy === `load-${v.id}`} disabled={isBusy || (loaded && inSync)}>Load</Button>
                <Button size="sm" onClick={onUpdateSelection} loading={busy === `snap-${v.id}`} disabled={isBusy || inSync} title="Replace this variant's items with the current selection">Update from selection</Button>
                <Button size="sm" variant="ghost" onClick={onDuplicate} loading={busy === `dup-${v.id}`} disabled={isBusy}>Duplicate</Button>
                <Button size="sm" variant="danger" onClick={onDelete} disabled={isBusy}>Delete</Button>
            </div>
        </li>
    );
}
