// src/components/ui/job-match/match-breakdown.tsx
"use client";

// The numbers behind a match score (lib/match/score.ts v2): headline with its uncertainty band and
// must-have count, sub-score bars, "what would move the score" gains, and per-requirement evidence.
// Useful marks only: bars and text, no decorative charts.

import React from "react";
import type { EvidenceVia, MatchResult, MatchRow, SubScores } from "@/lib/match/types";
import { MUST_GATE_CAP, SUB_WEIGHTS } from "@/lib/match/score";
import { cn } from "@/lib/cn";
import { ScoreRing } from "@/components/ui/primitives/score-ring";
import { Table, Td, Th } from "@/components/ui/primitives/table";

const SUB_LABEL: Record<keyof SubScores, { label: string; hint: string }> = {
    coverage: { label: "Requirements", hint: "How well your résumé evidences each requirement, by meaning, weighted by importance." },
    ats: { label: "ATS keywords", hint: "Hard requirements printed literally, counting more in your summary, skills and latest role." },
    years: { label: "Years", hint: "Dated experience behind each requirement vs the years the posting asks for." },
    title: { label: "Job title", hint: "How close your recent titles are to this one." },
    education: { label: "Credentials", hint: "Degrees, licences and certifications the posting asks for." },
};

const VIA_LABEL: Record<EvidenceVia, string> = {
    direct: "Direct",
    related: "Related",
    semantic: "Semantic",
    keyword: "Keyword only",
};

export function ScoreHeadline({ match }: { match: MatchResult }) {
    return (
        <div className="flex items-center gap-4">
            <ScoreRing score={match.score} size={80} />
            <div className="space-y-0.5">
                <p className="font-mono text-13 tabular-nums text-fg-muted" title="95% range from how certain each piece of evidence is">
                    {match.score} <span className="text-fg-subtle">±{match.band}</span>
                </p>
                <p className="text-13">
                    <span className="font-medium text-fg">Must-haves {match.must.hit}/{match.must.total}</span>
                    {match.nice.total > 0 && <span className="text-fg-muted"> · nice {match.nice.hit}/{match.nice.total}</span>}
                </p>
                {match.gated && (
                    <p className="text-xs text-warning">Capped at {MUST_GATE_CAP}: a hard must-have is missing.</p>
                )}
            </div>
        </div>
    );
}

export function SubScoreBars({ subScores }: { subScores: SubScores }) {
    const keys = (Object.keys(SUB_LABEL) as (keyof SubScores)[]).filter(k => subScores[k] !== null);
    return (
        <dl className="grid gap-2">
            {keys.map(k => {
                const v = subScores[k] ?? 0;
                return (
                    <div key={k} className="grid grid-cols-[7.5rem_1fr_2.5rem] items-center gap-3" title={SUB_LABEL[k].hint}>
                        <dt className="text-13 text-fg-muted">{SUB_LABEL[k].label} <span className="text-[11px] text-fg-subtle">{Math.round(SUB_WEIGHTS[k] * 100)}%</span></dt>
                        <dd className="h-1.5 overflow-hidden rounded-full bg-chart-track" aria-hidden>
                            <div className="h-full rounded-full bg-chart-1" style={{ width: `${Math.round(v * 100)}%` }} />
                        </dd>
                        <dd className="text-right font-mono text-13 tabular-nums text-fg">{Math.round(v * 100)}</dd>
                    </div>
                );
            })}
        </dl>
    );
}

/** Gaps ordered by how many points closing them is worth. */
export function WhatIfList({ rows, limit = 5 }: { rows: MatchRow[]; limit?: number }) {
    const gains = rows.filter(r => r.gain >= 0.5).sort((a, b) => b.gain - a.gain).slice(0, limit);
    if (gains.length === 0) return <p className="text-13 text-fg-muted">Nothing left that would move the score by a point or more.</p>;
    return (
        <ul className="space-y-1.5">
            {gains.map(r => (
                <li key={r.requirement.name} className="flex items-baseline justify-between gap-3 text-13">
                    <span className="min-w-0">
                        Show <span className="font-medium text-fg">{r.requirement.display}</span>
                        <span className="text-fg-subtle"> · {r.requirement.importance === "must" ? "must" : "nice"}, {r.tier}</span>
                    </span>
                    <span className="shrink-0 font-mono tabular-nums text-accent-text">+{r.gain.toFixed(r.gain < 10 ? 1 : 0)}</span>
                </li>
            ))}
        </ul>
    );
}

function StrengthCell({ row }: { row: MatchRow }) {
    const pct = Math.round(row.strength * 100);
    return (
        <span className="inline-flex items-center gap-2">
            <span className="h-1.5 w-12 overflow-hidden rounded-full bg-chart-track" aria-hidden>
                <span className="block h-full rounded-full bg-chart-1" style={{ width: `${pct}%` }} />
            </span>
            <span className={cn("font-mono text-xs tabular-nums", row.strength < 0.3 ? "text-danger" : "text-fg-muted")}>{pct}</span>
        </span>
    );
}

export function EvidenceTable({ rows }: { rows: MatchRow[] }) {
    return (
        <Table>
            <thead>
                <tr>
                    <Th>Requirement</Th>
                    <Th>Strength</Th>
                    <Th className="min-w-72">Best evidence</Th>
                    <Th>Years</Th>
                    <Th title="Printed literally where an ATS reader looks first">ATS</Th>
                </tr>
            </thead>
            <tbody>
                {rows.map(r => {
                    const top = r.evidence[0];
                    return (
                        <tr key={r.requirement.name}>
                            <Td className="whitespace-nowrap">
                                <span className={cn("font-medium", r.strength < 0.3 ? "text-danger" : "text-fg")}>{r.requirement.display}</span>
                                <span className="block text-xs text-fg-subtle">{r.requirement.importance === "must" ? "Must" : "Nice"} · {r.tier}</span>
                            </Td>
                            <Td><StrengthCell row={r} /></Td>
                            <Td className="min-w-72 text-xs leading-relaxed">
                                {top ? (
                                    <>
                                        <span className={cn("mr-1.5 rounded-sm px-1 py-0.5 text-[11px] font-medium", top.via === "keyword" ? "bg-warning-bg text-warning" : "bg-accent-subtle text-accent-text")}>{VIA_LABEL[top.via]}</span>
                                        <span className="text-fg">{top.quote ? `“${top.quote}”` : top.label}</span>
                                        {top.quote && <span className="block text-fg-subtle">{top.label}</span>}
                                        {r.evidence.length > 1 && <span className="block text-fg-subtle">+{r.evidence.length - 1} more {r.evidence.length === 2 ? "item" : "items"}</span>}
                                        {r.reason && <span className="block text-fg-muted">{r.reason}</span>}
                                    </>
                                ) : (
                                    <span className="text-fg-subtle">No evidence on this résumé</span>
                                )}
                            </Td>
                            <Td className="whitespace-nowrap font-mono text-xs tabular-nums">
                                {r.years ? <span className={r.years.have < r.years.need ? "text-warning" : "text-fg-muted"}>{r.years.have}/{r.years.need} y</span> : <span className="text-fg-subtle">–</span>}
                            </Td>
                            <Td className="whitespace-nowrap text-xs">
                                {r.tier === "soft" ? <span className="text-fg-subtle">–</span>
                                    : r.placement === 1 ? <span className="text-fg">Prominent</span>
                                    : r.placement > 0 ? <span className="text-fg-muted">Buried</span>
                                    : <span className="text-warning">Missing</span>}
                            </Td>
                        </tr>
                    );
                })}
            </tbody>
        </Table>
    );
}
