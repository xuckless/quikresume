// src/components/landing/landing-demo.tsx
"use client";

// Interactive landing-page demo: pick a profession, switch library items on and off, change the template,
// and watch a real job-match score move. The score is the dashboard's own pure scorer (lib/match/score.ts)
// over sample data (lib/demo/samples.ts). The résumé is an HTML approximation of the four Typst
// templates, so the landing page never loads the 7 MB Typst engine; the real thing runs in /start.

import React, { useState } from "react";
import Link from "next/link";
import { demoSamples, type DemoProfession } from "@/lib/demo/samples";
import { scoreJob } from "@/lib/match/score";
import { toTypstDoc } from "@/lib/typst/doc";
import { RESUME_LIST_KEYS, type ResumeData } from "@/types/schema";
import { cn } from "@/lib/cn";
import { Segmented } from "@/components/ui/primitives/segmented";
import { ScoreRing } from "@/components/ui/primitives/score-ring";
import { Checkbox } from "@/components/ui/primitives/field";
import { WhatIfList } from "@/components/ui/job-match/match-breakdown";

const SAMPLES = demoSamples();

type DemoTemplate = "ledger" | "classic" | "modern" | "compact";
/** How each Typst template reads on paper, approximated in CSS. */
const SHEETS: Record<DemoTemplate, { label: string; font: string; head: string; center: boolean; accent: string; rule: boolean; size: string }> = {
    ledger: { label: "Ledger", font: "var(--font-geist-sans), ui-sans-serif, system-ui", head: "var(--font-geist-sans), ui-sans-serif", center: false, accent: "#2f6b4f", rule: true, size: "11px" },
    classic: { label: "Classic", font: "Georgia, 'Times New Roman', serif", head: "Georgia, serif", center: true, accent: "#1a1a1a", rule: true, size: "11px" },
    modern: { label: "Modern", font: "var(--font-geist-sans), ui-sans-serif, system-ui", head: "var(--font-geist-sans), ui-sans-serif", center: false, accent: "#1e3a6e", rule: false, size: "11px" },
    compact: { label: "Compact", font: "var(--font-geist-sans), ui-sans-serif, system-ui", head: "var(--font-geist-sans), ui-sans-serif", center: false, accent: "#3d4757", rule: true, size: "10px" },
};

const SECTION_NAME: Partial<Record<(typeof RESUME_LIST_KEYS)[number], string>> = {
    workExperience: "Experience", education: "Education", certifications: "Licences & certifications", skills: "Skills",
};

function itemLabel(key: string, it: Record<string, unknown>): { title: string; sub: string } {
    if (key === "workExperience") return { title: String(it.title), sub: String(it.company) };
    if (key === "education") return { title: String(it.degree), sub: String(it.institution) };
    if (key === "certifications") return { title: String(it.name), sub: String(it.issuer) };
    if (key === "skills") return { title: String(it.category), sub: String(it.items) };
    return { title: "", sub: "" };
}

function SheetHeading({ template, children }: { template: DemoTemplate; children: React.ReactNode }) {
    const t = SHEETS[template];
    return (
        <div className="mt-3 mb-1" style={{ fontFamily: t.head }}>
            <span style={{ color: t.accent, fontSize: "9px", letterSpacing: template === "ledger" ? "0.14em" : "0.04em", fontWeight: 600, textTransform: template === "classic" ? "none" : "uppercase" }}>{children}</span>
            {t.rule && <div style={{ height: 1, background: template === "classic" ? "#1a1a1a" : `${t.accent}55`, marginTop: 2 }} />}
        </div>
    );
}

function Sheet({ resume, template }: { resume: ResumeData; template: DemoTemplate }) {
    const doc = toTypstDoc(resume);
    const t = SHEETS[template];
    return (
        <div className="bg-paper text-left shadow-sm ring-1 ring-border" style={{ fontFamily: t.font, fontSize: t.size, lineHeight: 1.35, color: "#1a1a1a", padding: template === "compact" ? "18px 20px" : "24px 26px", aspectRatio: "8.5 / 11", overflow: "hidden" }}>
            <div style={{ textAlign: t.center ? "center" : "left" }}>
                <div style={{ fontFamily: t.head, fontSize: template === "classic" ? "20px" : "18px", fontWeight: 600, color: template === "modern" ? t.accent : "#111" }}>{doc.header.name}</div>
                <div style={{ color: "#555" }}>{doc.header.tagline}</div>
                <div style={{ color: "#777", fontSize: "9px" }}>{[doc.header.location, doc.header.email, doc.header.phone].filter(Boolean).join("  ·  ")}</div>
            </div>
            {doc.summary && <><SheetHeading template={template}>Summary</SheetHeading><p style={{ margin: 0 }}>{doc.summary}</p></>}
            {doc.experience.length > 0 && <SheetHeading template={template}>Experience</SheetHeading>}
            {doc.experience.map((e, i) => (
                <div key={i} style={{ marginBottom: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <span><b>{e.title}</b> <span style={{ color: "#555" }}>{template === "classic" ? `, ${e.company}` : ` · ${e.company}`}</span></span>
                        <span style={{ color: "#777", whiteSpace: "nowrap", fontSize: "9px" }}>{e.date}</span>
                    </div>
                    <ul style={{ margin: "2px 0 0", paddingLeft: 14 }}>{e.bullets.map((b, j) => <li key={j}>{b}</li>)}</ul>
                </div>
            ))}
            {doc.education.length > 0 && <SheetHeading template={template}>Education</SheetHeading>}
            {doc.education.map((e, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span><b>{e.title}</b> <span style={{ color: "#555" }}>· {e.institution}</span></span>
                    <span style={{ color: "#777", fontSize: "9px", whiteSpace: "nowrap" }}>{e.date}</span>
                </div>
            ))}
            {doc.certifications.length > 0 && <SheetHeading template={template}>Licences &amp; certifications</SheetHeading>}
            {doc.certifications.map((c, i) => <div key={i}><b>{c.name}</b> <span style={{ color: "#555" }}>· {c.issuer} · {c.year}</span></div>)}
            {doc.skills.length > 0 && <SheetHeading template={template}>Skills</SheetHeading>}
            {doc.skills.map((s, i) => <div key={i}><b>{s.label}:</b> {s.value}</div>)}
        </div>
    );
}

export function LandingDemo() {
    const [prof, setProf] = useState<DemoProfession>("nursing");
    const [template, setTemplate] = useState<DemoTemplate>("ledger");
    const [overrides, setOverrides] = useState<Record<string, boolean>>({});
    const sample = SAMPLES.find(s => s.id === prof)!;

    const resume: ResumeData = { ...sample.resume };
    for (const key of RESUME_LIST_KEYS) {
        (resume[key] as unknown[]) = (sample.resume[key] as { id: string; isSelected: boolean }[]).map(it => ({ ...it, isSelected: overrides[it.id] ?? it.isSelected }));
    }
    const match = scoreJob(sample.job.requirements, resume, {}, { now: new Date(2026, 10, 1), seniority: sample.job.seniority });

    return (
        <div className="mt-14 rounded-lg border border-border bg-surface p-4 md:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <Segmented<DemoProfession> value={prof} onChange={v => { setProf(v); setOverrides({}); }} options={SAMPLES.map(s => ({ value: s.id, label: s.label }))} />
                <Segmented<DemoTemplate> value={template} onChange={setTemplate} options={(Object.keys(SHEETS) as DemoTemplate[]).map(k => ({ value: k, label: SHEETS[k].label }))} />
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.15fr)_minmax(0,0.9fr)]">
                <section aria-label="Library" className="space-y-3">
                    <h3 className="text-13 font-medium text-fg">Your library <span className="font-normal text-fg-subtle">· switch items on and off</span></h3>
                    {(Object.keys(SECTION_NAME) as (keyof typeof SECTION_NAME)[]).map(key => {
                        const items = sample.resume[key] as unknown as Record<string, unknown>[];
                        if (items.length === 0) return null;
                        return (
                            <div key={key}>
                                <p className="mb-1 text-xs text-fg-subtle">{SECTION_NAME[key]}</p>
                                <ul className="divide-y divide-border rounded-md border border-border">
                                    {items.map(it => {
                                        const itemId = String(it.id);
                                        const on = overrides[itemId] ?? Boolean(it.isSelected);
                                        const { title, sub } = itemLabel(key, it);
                                        return (
                                            <li key={itemId}>
                                                <label className={cn("flex cursor-pointer items-start gap-2.5 px-2.5 py-2 text-13", !on && "text-fg-subtle")}>
                                                    <Checkbox checked={on} onChange={e => setOverrides(o => ({ ...o, [itemId]: e.target.checked }))} className="mt-0.5" />
                                                    <span className="min-w-0">
                                                        <span className={cn("block truncate font-medium", on ? "text-fg" : "text-fg-subtle line-through decoration-border-strong")}>{title}</span>
                                                        <span className="block truncate text-xs text-fg-muted">{sub}</span>
                                                    </span>
                                                </label>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        );
                    })}
                </section>

                <section aria-label="Résumé preview" className="min-w-0">
                    <Sheet resume={resume} template={template} />
                </section>

                <section aria-label="Job match" className="space-y-4">
                    <div>
                        <p className="text-xs text-fg-subtle">Matching against</p>
                        <p className="text-13 font-medium text-fg">{sample.job.title} · {sample.job.company}</p>
                    </div>
                    <div className="flex items-center gap-4">
                        <ScoreRing score={match.score} size={72} showBand />
                        <div className="text-13">
                            <p className="font-mono tabular-nums text-fg-muted">{match.score} <span className="text-fg-subtle">±{match.band}</span></p>
                            <p className="font-medium text-fg">Must-haves {match.must.hit}/{match.must.total}</p>
                            {match.gated && <p className="text-xs text-warning">Capped at 70: a must-have is missing.</p>}
                        </div>
                    </div>
                    <div>
                        <p className="mb-1.5 text-13 font-medium text-fg">What would raise it</p>
                        <WhatIfList rows={match.rows} limit={4} />
                    </div>
                    <p className="text-xs text-fg-subtle">Try switching off an item that carries a must-have and watch the score drop.</p>
                    <Link href="/start" className="press inline-flex h-9 items-center rounded-md bg-accent px-3.5 text-13 font-medium text-accent-fg hover:bg-accent-hover">Try it with your résumé</Link>
                </section>
            </div>
        </div>
    );
}
