// src/components/ui/variant-toolbar.tsx
"use client";

// Library-view controls for saved variants: which one is loaded, save the
// current selection as a new one, load another, or update the loaded one.

import { useFormsOperation } from "@/lib/ui/use-forms-operation";
import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ResumeData } from "@/types/schema";
import type { ResumeVariant } from "@/types/db";
import { createVariant, loadVariant, resnapshotVariant } from "@/app/actions/variant-actions";
import { selectionEquals } from "@/lib/variants";
import { Button } from "@/components/ui/primitives/button";
import { Input, Select } from "@/components/ui/primitives/field";
import { Badge } from "@/components/ui/primitives/badge";

interface VariantToolbarProps {
    variants: ResumeVariant[];
    loadedVariantId: string | null;
    /** Server truth (not the draft): the working selection variants are snapshotted from. */
    data: ResumeData;
    onNotice: (text: string, tone?: "ok" | "warn") => void;
}

export function VariantToolbar({ variants, loadedVariantId, data, onNotice }: VariantToolbarProps) {
    const router = useRouter();
    const [naming, setNaming] = useState(false);
    const [name, setName] = useState("");
    const operation = useFormsOperation<"update" | "create" | "load", string>();
    const busy = operation.state.status === "running" ? operation.state.operation : null;
    const loaded = variants.find(v => v.id === loadedVariantId) ?? null;
    const inSync = loaded ? selectionEquals(data, loaded.items, loaded.hidden) : false;

    const run = async (key: "update" | "create" | "load", fn: () => Promise<string>) => {
        const id = operation.begin(key);
        if (id === null) return;
        try {
            const message = await fn();
            operation.succeed(id, message);
            onNotice(message);
            router.refresh();
        } catch (err) {
            operation.fail(id, err instanceof Error ? err.message : "Something went wrong.");
            onNotice(err instanceof Error ? err.message : "Something went wrong.", "warn");
        }
    };

    return (
        <div className="flex flex-wrap items-center gap-2">
            {loaded && (
                <Badge tone="strong" title={loaded.labels.join(", ")}>
                    {loaded.name}{inSync ? "" : " · modified"}
                </Badge>
            )}
            {loaded && !inSync && (
                <Button size="sm" disabled={busy !== null} loading={busy === "update"} onClick={() => run("update", async () => { await resnapshotVariant(loaded.id); return `"${loaded.name}" updated to the current selection.`; })}>
                    Update {loaded.name}
                </Button>
            )}
            {naming ? (
                <form
                    className="flex items-center gap-2"
                    onSubmit={e => {
                        e.preventDefault();
                        if (!name.trim()) return;
                        run("create", async () => { await createVariant({ name }); setNaming(false); setName(""); return `Saved the current selection as "${name.trim()}".`; });
                    }}
                >
                    <Input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Variant name" className="h-8 w-44 text-13" />
                    <Button size="sm" variant="primary" type="submit" disabled={busy !== null || !name.trim()} loading={busy === "create"}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setNaming(false); setName(""); }}>Cancel</Button>
                </form>
            ) : (
                <Button size="sm" disabled={busy !== null} onClick={() => setNaming(true)}>Save as variant</Button>
            )}
            {variants.length > 0 && (
                <Select
                    value=""
                    disabled={busy !== null}
                    aria-label="Load a variant"
                    className="w-40"
                    onChange={e => {
                        const id = e.target.value;
                        const v = variants.find(x => x.id === id);
                        if (!v) return;
                        run("load", async () => {
                            const r = await loadVariant(v.id);
                            return r.missing > 0 ? `Loaded "${v.name}". ${r.missing} missing ${r.missing === 1 ? "item was" : "items were"} dropped.` : `Loaded "${v.name}".`;
                        });
                    }}
                >
                    <option value="">{busy === "load" ? "Loading…" : "Load variant…"}</option>
                    {variants.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </Select>
            )}
            <Link href="/dashboard/variants" className="text-13 text-fg-muted hover:text-fg px-1">Manage</Link>
        </div>
    );
}
