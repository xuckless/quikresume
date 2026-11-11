"use client";

// Tailor window step 1: "Do you have X?" for the job's requirements that nothing
// in the library covers, hard ones first. Yes on a soft requirement -> printed
// "Soft skills" category; Yes on a hard requirement -> the skill category picked
// here (or by the AI). An optional example is worded into a bullet. No ->
// remembered and warned about on later jobs until answered Yes. Saved through
// /api/jobs/skill-answers.

import React, { useState } from "react";
import type { ResumeData } from "@/types/schema";
import type { DeclinedSkill, Requirement } from "@/lib/match/types";
import { requirementTier } from "@/lib/match/score";
import { itemTitle, SECTION_LABEL } from "@/lib/sections";
import { cn } from "@/lib/cn";
import { Button, FOCUS_RING } from "@/components/ui/primitives/button";
import { Input, Select } from "@/components/ui/primitives/field";
import { Badge } from "@/components/ui/primitives/badge";
import { NoticeBanner } from "@/components/ui/primitives/notice-banner";
import { useOperation } from "@/lib/ui/use-operation";

type Choice = "yes" | "no" | "skip";
interface Answer { choice: Choice; example: string; itemId: string; categoryId: string }

export interface SkillsSaved {
    resume: ResumeData;
    declined: DeclinedSkill[];
    warning?: string;
}

interface SkillQuestionsProps {
    /** Requirements of the job no library item covers (hard and soft). */
    gaps: Requirement[];
    declined: DeclinedSkill[];
    library: ResumeData;
    onSaved: (result: SkillsSaved) => void;
    /** Continue without saving anything. */
    onSkip?: () => void;
    skipLabel?: string;
    saveLabel?: string;
}

const EVIDENCE_SECTIONS = ["workExperience", "projects", "volunteering"] as const;
const SOFT_CATEGORY = "soft skills";

export function SkillQuestions({ gaps, declined, library, onSaved, onSkip, skipLabel = "Skip questions", saveLabel = "Save answers" }: SkillQuestionsProps) {
    const declinedNames = new Set(declined.map(d => d.name));
    const byTier = (a: Requirement, b: Requirement) => (requirementTier(a) === requirementTier(b) ? 0 : requirementTier(a) === "hard" ? -1 : 1);
    const toAsk = gaps.filter(r => !declinedNames.has(r.name)).sort(byTier);
    const previouslyDeclined = gaps.filter(r => declinedNames.has(r.name)).sort(byTier);

    const [answers, setAnswers] = useState<Record<string, Answer>>({});
    const [reopened, setReopened] = useState<Set<string>>(new Set());
    const saveOp = useOperation<"save", SkillsSaved>();
    const saving = saveOp.running !== null;

    const evidenceItems = EVIDENCE_SECTIONS.flatMap(key => library[key].map(item => ({ id: item.id, label: `${SECTION_LABEL[key]} · ${itemTitle(key, item)}` })));
    const categories = library.skills.filter(s => s.category.trim().toLowerCase() !== SOFT_CATEGORY);
    const answerOf = (name: string): Answer => answers[name] ?? { choice: "skip", example: "", itemId: "", categoryId: "" };
    const set = (name: string, patch: Partial<Answer>) => setAnswers(prev => ({ ...prev, [name]: { ...answerOf(name), ...patch } }));

    const rows = [...toAsk, ...previouslyDeclined.filter(r => reopened.has(r.name))];
    const decided = rows.filter(r => answerOf(r.name).choice !== "skip");
    const hasHard = rows.some(r => requirementTier(r) === "hard");

    const save = async () => {
        const payload = decided.map(r => {
            const a = answerOf(r.name);
            const yes = a.choice === "yes";
            const hard = requirementTier(r) === "hard";
            return { name: r.name, display: r.display, kind: r.kind, hard, have: yes, categoryId: yes && hard ? a.categoryId : "", example: yes ? a.example : "", itemId: yes ? a.itemId : "" };
        });
        const settled = await saveOp.run("save", async () => {
            const res = await fetch("/api/jobs/skill-answers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers: payload }) });
            const json = (await res.json().catch(() => null)) as ({ ok: true } & SkillsSaved) | { ok: false; error: string } | null;
            if (!json) throw new Error(`Saving failed (${res.status}).`);
            if (!json.ok) throw new Error(json.error);
            return { resume: json.resume, declined: json.declined, warning: json.warning };
        }, "Could not save your answers.");
        if (settled?.ok) onSaved(settled.result);
    };

    return (
        <div className="space-y-4">
            {saveOp.error && <NoticeBanner tone="danger" onDismiss={saveOp.reset}>{saveOp.error}</NoticeBanner>}

            {rows.length > 0 ? (
                <>
                    <p className="text-13 text-fg-muted">
                        The job asks for these and nothing in your library shows them yet. Answer honestly: a Yes adds the skill to your skills
                        section ({hasHard ? <>technical skills go into the category you pick, soft skills into <span className="font-medium text-fg">Soft skills</span></> : <span className="font-medium text-fg">Soft skills</span>}), and an example becomes a bullet.
                    </p>
                    <ul className="divide-y divide-border rounded-lg border border-border">
                        {rows.map(r => {
                            const a = answerOf(r.name);
                            const hard = requirementTier(r) === "hard";
                            return (
                                <li key={r.name} className="space-y-3 px-4 py-3">
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                                        <p className="min-w-0 flex-1 text-sm text-fg">
                                            Do you have <span className="font-medium">{r.display}</span>?
                                            <Badge size="xs" tone={hard ? "strong" : "neutral"} className="ml-2 align-middle">{hard ? "hard" : "soft"}{r.importance === "must" ? " · must" : ""}</Badge>
                                        </p>
                                        <div className="flex gap-1" role="radiogroup" aria-label={`Do you have ${r.display}?`}>
                                            {(["yes", "no", "skip"] as const).map(c => (
                                                <button
                                                    key={c}
                                                    type="button"
                                                    role="radio"
                                                    aria-checked={a.choice === c}
                                                    onClick={() => set(r.name, { choice: c })}
                                                    className={cn(
                                                        "h-7 rounded-md border px-2.5 text-xs font-medium transition-colors",
                                                        a.choice === c
                                                            ? c === "yes" ? "border-accent bg-accent text-accent-fg" : c === "no" ? "border-danger-border bg-danger-bg text-danger" : "border-border-strong bg-surface-muted text-fg"
                                                            : "border-border bg-surface text-fg-muted hover:text-fg",
                                                        FOCUS_RING,
                                                    )}
                                                >
                                                    {c === "yes" ? "Yes" : c === "no" ? "No" : "Not now"}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    {a.choice === "yes" && (
                                        <div className={cn("grid gap-2", hard ? "md:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_minmax(0,14rem)]" : "md:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]")}>
                                            {hard && (
                                                <Select value={a.categoryId} onChange={e => set(r.name, { categoryId: e.target.value })} aria-label={`Skill category for ${r.display}`} selectClassName="h-8 text-13">
                                                    <option value="">Let AI pick a category</option>
                                                    {categories.map(s => <option key={s.id} value={s.id}>{s.category || "Untitled category"}</option>)}
                                                </Select>
                                            )}
                                            <Input
                                                value={a.example}
                                                onChange={e => set(r.name, { example: e.target.value })}
                                                placeholder={`Optional: where did you use ${hard ? r.display : r.display.toLowerCase()}? (one line)`}
                                                className="h-8 text-13"
                                                aria-label={`Example of ${r.display}`}
                                            />
                                            <Select
                                                value={a.itemId}
                                                onChange={e => set(r.name, { itemId: e.target.value })}
                                                disabled={!a.example.trim()}
                                                aria-label="Add the example to"
                                                selectClassName="h-8 text-13"
                                            >
                                                <option value="">{a.example.trim() ? "Add the bullet to…" : "Write an example first"}</option>
                                                {evidenceItems.map(it => <option key={it.id} value={it.id}>{it.label}</option>)}
                                            </Select>
                                        </div>
                                    )}
                                    {a.choice === "no" && (
                                        <p className="text-xs text-fg-subtle">
                                            Remembered. {hard && r.importance === "must" ? "This is a must-have, so the résumé will be flagged as missing it. " : ""}Jobs that need it will warn you until you add it.
                                        </p>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </>
            ) : previouslyDeclined.length === 0 ? (
                <p className="text-13 text-fg-muted">Your library already covers every requirement of this job.</p>
            ) : null}

            {previouslyDeclined.some(r => !reopened.has(r.name)) && (
                <div className="space-y-2 rounded-lg border border-warning-border bg-warning-bg px-4 py-3">
                    <p className="text-13 font-medium text-warning">You said you don&apos;t have these, and this job asks for them</p>
                    <ul className="space-y-1.5">
                        {previouslyDeclined.filter(r => !reopened.has(r.name)).map(r => (
                            <li key={r.name} className="flex items-center gap-3 text-13">
                                <span className="min-w-0 flex-1 text-fg">{r.display}{requirementTier(r) === "hard" ? " · hard" : ""}{r.importance === "must" ? " · must-have" : ""}</span>
                                <Button size="sm" onClick={() => { setReopened(prev => new Set(prev).add(r.name)); set(r.name, { choice: "yes" }); }}>I have this now</Button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                {onSkip && <Button variant="ghost" onClick={onSkip} disabled={saving}>{skipLabel}</Button>}
                <Button variant="primary" onClick={save} loading={saving} disabled={decided.length === 0}>
                    {saving ? "Saving…" : `${saveLabel}${decided.length ? ` (${decided.length})` : ""}`}
                </Button>
            </div>
        </div>
    );
}
