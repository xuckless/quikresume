// src/components/ui/proposal-cards.tsx
"use client";

import React from "react";
import type { MuteRule, Proposal, ProposalKind } from "@/lib/match/types";
import { describeMuteRule } from "@/lib/match/proposals";
import { SECTION_LABEL } from "@/lib/sections";
import { cn } from "@/lib/cn";
import { Badge, type BadgeTone } from "@/components/ui/primitives/badge";
import { Button } from "@/components/ui/primitives/button";
import { ChevronDown } from "@/components/ui/primitives/icons";

const KIND_META: Record<ProposalKind, { label: string; tone: BadgeTone }> = {
    include: { label: "Include", tone: "success" },
    exclude: { label: "Exclude", tone: "warning" },
    "rewrite-bullet": { label: "Rewrite", tone: "neutral" },
    "add-skill": { label: "Add skill", tone: "neutral" },
    gap: { label: "Gap", tone: "danger" },
};

interface ProposalCardsProps {
    proposals: Proposal[];
    requirementDisplay: (name: string) => string;
    busyId: string | null;
    onApply: (p: Proposal) => void;
    onSkip: (p: Proposal) => void;
    onIgnoreSimilar: (p: Proposal) => void;
    onReopen: (p: Proposal) => void;
    muted: MuteRule[];
    onUnmute: (r: MuteRule) => void;
}

export function ProposalCards({ proposals, requirementDisplay, busyId, onApply, onSkip, onIgnoreSimilar, onReopen, muted, onUnmute }: ProposalCardsProps) {
    const open = proposals.filter(p => p.status === "open");
    const done = proposals.filter(p => p.status !== "open");

    return (
        <div className="space-y-3">
            {open.length === 0 && (
                <div className="rounded-lg border border-dashed border-border-strong px-4 py-8 text-center text-13 text-fg-muted">
                    {proposals.length === 0 ? "No suggestions yet." : "You have gone through every suggestion."}
                </div>
            )}
            {open.length > 0 && (
                <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
                    {open.map(p => (
                        <li key={p.id}>
                            <ProposalCard p={p} requirementDisplay={requirementDisplay} busy={busyId === p.id}>
                                {p.kind !== "gap" && <Button size="sm" variant="primary" onClick={() => onApply(p)} disabled={busyId !== null}>Apply</Button>}
                                <Button size="sm" variant="ghost" onClick={() => onSkip(p)} disabled={busyId !== null}>{p.kind === "gap" ? "Dismiss" : "Skip"}</Button>
                                <Button size="sm" variant="ghost" onClick={() => onIgnoreSimilar(p)} disabled={busyId !== null} title="Never suggest this again">Ignore similar</Button>
                            </ProposalCard>
                        </li>
                    ))}
                </ul>
            )}

            {done.length > 0 && (
                <Group label={`${done.length} handled`}>
                    {done.map(p => (
                        <li key={p.id} className="flex items-center justify-between gap-3 py-1.5 text-13">
                            <span className="flex min-w-0 items-center gap-2">
                                <Badge tone={KIND_META[p.kind].tone}>{KIND_META[p.kind].label}</Badge>
                                <span className="truncate text-fg-muted">{p.itemLabel ?? p.tags.map(requirementDisplay).join(", ")}</span>
                                <span className="shrink-0 text-fg-subtle">· {p.status}</span>
                            </span>
                            <Button size="sm" variant="ghost" onClick={() => onReopen(p)}>Reopen</Button>
                        </li>
                    ))}
                </Group>
            )}

            {muted.length > 0 && (
                <Group label={`${muted.length} muted ${muted.length === 1 ? "rule" : "rules"}`}>
                    {muted.map((r, i) => (
                        <li key={i} className="flex items-center justify-between gap-3 py-1.5 text-13">
                            <span className="text-fg-muted">{describeMuteRule(r)}{r.tag ? ` (${requirementDisplay(r.tag)})` : ""}</span>
                            <Button size="sm" variant="ghost" onClick={() => onUnmute(r)}>Unmute</Button>
                        </li>
                    ))}
                </Group>
            )}
        </div>
    );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <details className="group disclosure rounded-lg border border-border bg-surface-muted/50 px-4 py-2">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-13 text-fg-muted [&::-webkit-details-marker]:hidden">
                <ChevronDown className="size-3.5 transition-move group-open:rotate-180" aria-hidden />
                {label}
            </summary>
            <ul className="mt-2 divide-y divide-border">{children}</ul>
        </details>
    );
}

function ProposalCard({ p, requirementDisplay, busy, children }: { p: Proposal; requirementDisplay: (n: string) => string; busy: boolean; children: React.ReactNode }) {
    const meta = KIND_META[p.kind];
    return (
        <div className={cn("space-y-3 p-4", busy && "opacity-60")}>
            <div className="flex flex-wrap items-center gap-2">
                <Badge tone={meta.tone}>{meta.label}</Badge>
                {p.section && <span className="text-xs text-fg-subtle">{SECTION_LABEL[p.section]}</span>}
                {p.itemLabel && <span className="truncate text-sm font-medium text-fg">{p.itemLabel}</span>}
                {p.tags.length > 0 && (
                    <span className="ml-auto flex flex-wrap gap-1">
                        {p.tags.slice(0, 4).map(t => <Badge key={t}>{requirementDisplay(t)}</Badge>)}
                    </span>
                )}
            </div>
            {p.kind === "rewrite-bullet" && (
                <div className="grid gap-2 text-13 md:grid-cols-2">
                    <div className="rounded-md bg-surface-muted p-3">
                        <p className="mb-1 text-xs text-fg-subtle">Now</p>
                        <p className="text-fg-muted">{p.current}</p>
                    </div>
                    <div className="rounded-md border border-border bg-surface p-3">
                        <p className="mb-1 text-xs text-fg-subtle">Proposed</p>
                        <p className="text-fg">{p.proposed}</p>
                    </div>
                </div>
            )}
            {p.kind === "add-skill" && (
                <p className="text-13 text-fg-muted">Add <span className="font-medium text-fg">{p.proposed}</span> to <span className="font-medium text-fg">{p.itemLabel}</span>.</p>
            )}
            <p className="text-13 text-fg-muted">{p.reason}</p>
            <div className="flex flex-wrap gap-1.5 pt-1">{children}</div>
        </div>
    );
}
