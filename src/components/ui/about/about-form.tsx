"use client";

// "About you" questionnaire: Core / Targeting / Narrative / Follow-ups. Answers start from what was saved,
// or (first time) from the library: dates-based facts at once, AI suggestions when /api/about/prefill
// answers. Suggested fields are marked until the user edits them. Finish writes the candidate brief.

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { formatMonthYear } from "@/lib/dates";
import { readJson } from "@/lib/ui/fetch-json";
import { useOperation } from "@/lib/ui/use-operation";
import { coreHash } from "@/lib/about/facts";
import {
    AUTHORIZATION_OPTIONS, EDUCATION_OPTIONS, RELOCATION_OPTIONS, SENIORITY_OPTIONS, WORK_MODE_OPTIONS, emptyAnswers,
    type Characterization, type CharacterizationAnswers, type EducationStatus, type FollowUp,
} from "@/lib/about/types";
import { markCharacterizationSeen, skipCharacterization } from "@/app/actions/about-actions";
import { Button } from "@/components/ui/primitives/button";
import { Card, CardBody, CardHeader } from "@/components/ui/primitives/card";
import { Checkbox, Field, Input, Label, Select, Textarea } from "@/components/ui/primitives/field";
import { ChipInput } from "@/components/ui/primitives/chip-input";
import { MonthField } from "@/components/ui/primitives/month-field";
import { NoticeBanner } from "@/components/ui/primitives/notice-banner";
import { Segmented } from "@/components/ui/primitives/segmented";
import { Tabs } from "@/components/ui/primitives/tabs";
import { Sparkles } from "@/components/ui/primitives/icons";

type Step = "core" | "targeting" | "narrative" | "follow-ups";
const STEPS: { value: Step; label: string }[] = [
    { value: "core", label: "Core" },
    { value: "targeting", label: "Targeting" },
    { value: "narrative", label: "Your story" },
    { value: "follow-ups", label: "Follow-ups" },
];

type SuggestKey = "field" | "yearsExperience" | "educationStatus" | "graduationDate" | "targetRoles" | "targetSeniority" | "targetIndustries" | "strengths" | "careerChange";

interface Computed { yearsExperience: number | null; educationStatus: EducationStatus; graduation: string }
interface Gap { from: string; to: string; months: number }

interface PrefillReply {
    suggestions: Partial<Pick<CharacterizationAnswers, "field" | "targetRoles" | "targetSeniority" | "targetIndustries" | "strengths" | "careerChange">> | null;
    warning?: string;
}

const isBlank = (v: unknown) => v === "" || v === null || (Array.isArray(v) && v.length === 0);

function seedFromLibrary(computed: Computed): { answers: CharacterizationAnswers; suggested: Set<SuggestKey> } {
    const answers = emptyAnswers();
    const suggested = new Set<SuggestKey>();
    if (computed.yearsExperience !== null) { answers.yearsExperience = computed.yearsExperience; suggested.add("yearsExperience"); }
    if (computed.educationStatus) { answers.educationStatus = computed.educationStatus; suggested.add("educationStatus"); }
    if (computed.graduation) { answers.graduationDate = computed.graduation; suggested.add("graduationDate"); }
    return { answers, suggested };
}

export function AboutForm({ saved, computed, gaps, emptyLibrary, firstRun }: {
    saved: Characterization;
    computed: Computed;
    gaps: Gap[];
    emptyLibrary: boolean;
    firstRun: boolean;
}) {
    const router = useRouter();
    const fresh = saved.status === null || (saved.status === "skipped" && saved.answersHash === null);
    // Seeded once; never re-synced from props (revalidation after saving must not reset what is typed).
    const [seed] = useState(() => (fresh ? seedFromLibrary(computed) : { answers: saved.answers, suggested: new Set<SuggestKey>() }));
    const [answers, setAnswers] = useState<CharacterizationAnswers>(seed.answers);
    const [suggested, setSuggested] = useState<ReadonlySet<SuggestKey>>(seed.suggested);
    const [followUps, setFollowUps] = useState<FollowUp[]>(saved.followUps);
    const [followUpsHash, setFollowUpsHash] = useState<string | null>(saved.followUpsHash);
    const [step, setStep] = useState<Step>("core");
    const [prefill, setPrefill] = useState<"loading" | "done">(fresh && !emptyLibrary ? "loading" : "done");
    const prefilling = prefill === "loading";
    const submit = useOperation<"draft" | "finish" | "skip", string | null>();
    // After a successful skip the page is navigating away; keep the buttons locked until it does.
    const busy = submit.running ?? (submit.state.status === "succeeded" && submit.state.kind === "skip" ? "skip" : null);
    // Writing follow-up questions is a background AI call: it never blocks Skip / Save draft / Finish.
    const questions = useOperation<"generate", { questions: FollowUp[]; coreHash: string | null }>();
    const writingQuestions = questions.running !== null;
    const error = submit.error ?? questions.error;
    const [notice, setNotice] = useState<{ tone: "success" | "warning"; text: string } | null>(
        saved.briefStale ? { tone: "warning", text: "Your last AI summary could not be written. Finish again to retry." } : null,
    );

    // First visit only: AI suggestions from the library fill fields that are still empty.
    useEffect(() => {
        if (saved.status === null) void markCharacterizationSeen().catch(() => {});
        if (!fresh || emptyLibrary) return;
        let cancelled = false;
        fetch("/api/about/prefill", { method: "POST" })
            .then(res => readJson<PrefillReply>(res))
            .then(reply => {
                if (cancelled) return;
                setPrefill("done");
                if (!reply.ok) return;
                if (reply.warning) setNotice({ tone: "warning", text: reply.warning });
                const s = reply.suggestions;
                if (!s) return;
                const filled: SuggestKey[] = [];
                setAnswers(prev => {
                    const next = { ...prev };
                    const take = <K extends SuggestKey & keyof typeof s>(key: K) => {
                        const value = s[key];
                        if (value === undefined || isBlank(value) || !isBlank(prev[key])) return;
                        (next as Record<string, unknown>)[key] = value;
                        filled.push(key);
                    };
                    take("field"); take("targetRoles"); take("targetSeniority"); take("targetIndustries"); take("strengths");
                    if (s.careerChange && s.careerChange.changing !== null && prev.careerChange.changing === null) {
                        next.careerChange = s.careerChange;
                        filled.push("careerChange");
                    }
                    return next;
                });
                setSuggested(prev => new Set([...prev, ...filled]));
            })
            .catch(() => { if (!cancelled) setPrefill("done"); });
        return () => { cancelled = true; };
        // Runs once on mount: `fresh` and `emptyLibrary` come from the first server render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const set = <K extends keyof CharacterizationAnswers>(key: K, value: CharacterizationAnswers[K]) => {
        if (writingQuestions) questions.reset(); // typing supersedes the question run in flight
        setAnswers(prev => ({ ...prev, [key]: value, ...(key === "yearsExperience" ? { yearsSource: "user" as const } : {}) }));
        if (suggested.has(key as SuggestKey)) setSuggested(prev => { const n = new Set(prev); n.delete(key as SuggestKey); return n; });
    };

    const hint = (key: SuggestKey, fallback?: string) => (suggested.has(key) ? (key === "yearsExperience" || key === "educationStatus" || key === "graduationDate" ? "Calculated from your library dates. Change it if it's off." : "Suggested from your library. Edit if it's off.") : fallback);

    const generateQuestions = async () => {
        const done = await questions.run("generate", async () => {
            const res = await fetch("/api/about/follow-ups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers }) });
            const reply = await readJson<{ questions: FollowUp[]; coreHash: string }>(res);
            if (!reply.ok || !reply.questions) throw new Error(reply.error ?? "Could not generate questions.");
            return { questions: reply.questions, coreHash: reply.coreHash ?? null };
        }, "Could not generate questions.");
        if (!done?.ok) return;
        const { questions: generated, coreHash } = done.result;
        // Keep answers to questions that come back word for word (including ones typed while this ran).
        setFollowUps(current => {
            const previous = new Map(current.map(f => [f.question, f.answer]));
            return generated.map(q => ({ ...q, answer: previous.get(q.question) ?? "" }));
        });
        setFollowUpsHash(coreHash);
    };

    const goTo = (next: Step) => {
        setStep(next);
        if (next === "follow-ups" && !writingQuestions && busy === null && coreHash(answers) !== followUpsHash) void generateQuestions();
    };

    const save = async (status: "draft" | "complete") => {
        setNotice(null);
        const done = await submit.run(status === "complete" ? "finish" : "draft", async () => {
            const res = await fetch("/api/about/save", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ answers, followUps, followUpsHash, status }),
            });
            const reply = await readJson<{ status: string; briefUpdated: boolean; warning?: string }>(res);
            if (!reply.ok) throw new Error(reply.error ?? "Could not save your answers.");
            return reply.warning ?? null;
        }, "Could not save your answers.");
        if (!done?.ok) return;
        const warning = done.result;
        if (status === "complete" && !warning) {
            router.push("/dashboard");
            return;
        }
        setNotice(warning ? { tone: "warning", text: warning } : { tone: "success", text: "Draft saved." });
        router.refresh();
    };

    const skip = async () => {
        const done = await submit.run("skip", async () => { await skipCharacterization(); return null; }, "Could not skip.");
        if (done?.ok) router.push("/dashboard");
    };

    const stepIndex = STEPS.findIndex(s => s.value === step);
    const canFinish = answers.field.trim() !== "" || answers.targetRoles.length > 0;

    return (
        <div className="space-y-4">
            {firstRun && saved.status !== "complete" && (
                <Card className="border-border-strong">
                    <CardBody className="flex items-start gap-3 pt-4">
                        <Sparkles className="mt-0.5 size-4 shrink-0 text-fg-subtle" aria-hidden />
                        <div className="text-13 text-fg-muted">
                            <p className="font-medium text-fg">Welcome! A few questions first.</p>
                            <p>It takes about two minutes. Your answers stay private and help the AI review your items and tailor résumés for the roles you want. You can skip and come back from the sidebar.</p>
                        </div>
                    </CardBody>
                </Card>
            )}
            {prefilling && <NoticeBanner tone="success">Reading your library to suggest answers…</NoticeBanner>}
            {notice && <NoticeBanner tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</NoticeBanner>}
            {error && <NoticeBanner tone="danger" onDismiss={() => { submit.reset(); questions.reset(); }}>{error}</NoticeBanner>}

            <div className="border-b border-border">
                <Tabs items={STEPS} value={step} onChange={goTo} aria-label="Questionnaire steps" />
            </div>

            {step === "core" && (
                <Card>
                    <CardHeader title="Where you are" hint="The basics every piece of advice depends on." />
                    <CardBody className="grid gap-4 md:grid-cols-2">
                        <Field label="Field / industry" htmlFor="about-field" hint={hint("field", "e.g. Software Engineering, Nursing, Marketing")} className="md:col-span-2">
                            <Input id="about-field" value={answers.field} onChange={e => set("field", e.target.value)} placeholder="Software Engineering" />
                        </Field>
                        <Field label="Years of professional experience" htmlFor="about-years" hint={hint("yearsExperience", computed.yearsExperience !== null && answers.yearsExperience !== computed.yearsExperience ? `Your library dates add up to ${computed.yearsExperience} (internships not counted).` : "Internships don't count here.")}>
                            <Input
                                id="about-years" type="number" min={0} max={60} step={0.5} inputMode="decimal"
                                value={answers.yearsExperience ?? ""}
                                onChange={e => set("yearsExperience", e.target.value === "" ? null : Math.max(0, Math.min(60, Number(e.target.value))))}
                            />
                        </Field>
                        <Field label="Education" htmlFor="about-edu" hint={hint("educationStatus")}>
                            <Select id="about-edu" value={answers.educationStatus} onChange={e => set("educationStatus", e.target.value as EducationStatus)}>
                                {EDUCATION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </Select>
                        </Field>
                        {(answers.educationStatus === "in-school" || answers.educationStatus === "graduated") && (
                            <Field label={answers.educationStatus === "in-school" ? "Expected graduation" : "Graduated"} htmlFor="about-grad" hint={hint("graduationDate")} className="md:col-span-2">
                                <MonthField id="about-grad" value={answers.graduationDate} onChange={v => set("graduationDate", v)} className="md:max-w-sm" />
                            </Field>
                        )}
                        <Field label="Positions you're looking for" htmlFor="about-roles" hint={hint("targetRoles", "Up to 6 job titles. Press Enter after each.")} className="md:col-span-2">
                            <ChipInput id="about-roles" values={answers.targetRoles} onChange={v => set("targetRoles", v)} placeholder="Backend Engineer" max={6} />
                        </Field>
                    </CardBody>
                </Card>
            )}

            {step === "targeting" && (
                <Card>
                    <CardHeader title="What you're aiming for" hint="Level, industries and practical constraints." />
                    <CardBody className="grid gap-4 md:grid-cols-2">
                        <Field label="Target level" htmlFor="about-level" hint={hint("targetSeniority")}>
                            <Select id="about-level" value={answers.targetSeniority} onChange={e => set("targetSeniority", e.target.value as CharacterizationAnswers["targetSeniority"])}>
                                {SENIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </Select>
                        </Field>
                        <Field label="Industries" htmlFor="about-industries" hint={hint("targetIndustries", "Optional. e.g. Fintech, Healthcare")}>
                            <ChipInput id="about-industries" values={answers.targetIndustries} onChange={v => set("targetIndustries", v)} placeholder="Fintech" max={6} />
                        </Field>
                        <Field label="Locations" htmlFor="about-locations" hint="Cities or regions you'd work in." className="md:col-span-2">
                            <ChipInput id="about-locations" values={answers.locations} onChange={v => set("locations", v)} placeholder="Seattle, WA" max={6} />
                        </Field>
                        <div>
                            <Label>Work mode</Label>
                            <div className="flex h-9 flex-wrap items-center gap-4">
                                {WORK_MODE_OPTIONS.map(o => (
                                    <label key={o.value} className="flex items-center gap-2 text-sm text-fg">
                                        <Checkbox
                                            checked={answers.workModes.includes(o.value)}
                                            onChange={e => set("workModes", e.target.checked ? [...answers.workModes, o.value] : answers.workModes.filter(m => m !== o.value))}
                                        />
                                        {o.label}
                                    </label>
                                ))}
                            </div>
                        </div>
                        <Field label="Open to relocating?" htmlFor="about-relocation">
                            <Select id="about-relocation" value={answers.relocation} onChange={e => set("relocation", e.target.value as CharacterizationAnswers["relocation"])}>
                                {RELOCATION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </Select>
                        </Field>
                        <Field label="Work authorization" htmlFor="about-auth" hint="Only used to flag postings that can't sponsor. Never printed.">
                            <Select id="about-auth" value={answers.workAuthorization} onChange={e => set("workAuthorization", e.target.value as CharacterizationAnswers["workAuthorization"])}>
                                {AUTHORIZATION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </Select>
                        </Field>
                        {(answers.workAuthorization === "authorized" || answers.workAuthorization === "needs-sponsorship") && (
                            <Field label="Country" htmlFor="about-country">
                                <Input id="about-country" value={answers.authorizationCountry} onChange={e => set("authorizationCountry", e.target.value)} placeholder="United States" />
                            </Field>
                        )}
                    </CardBody>
                </Card>
            )}

            {step === "narrative" && (
                <Card>
                    <CardHeader title="Your story" hint="How a coach should frame your background." />
                    <CardBody className="space-y-5">
                        <div className="space-y-3">
                            <Label>Are you changing careers?</Label>
                            <YesNo value={answers.careerChange.changing} onChange={v => set("careerChange", { ...answers.careerChange, changing: v })} />
                            {suggested.has("careerChange") && <p className="text-13 text-fg-subtle">Suggested from your library. Edit if it&apos;s off.</p>}
                            {answers.careerChange.changing && (
                                <div className="grid gap-4 md:grid-cols-2">
                                    <Field label="From" htmlFor="about-cc-from"><Input id="about-cc-from" value={answers.careerChange.from} onChange={e => set("careerChange", { ...answers.careerChange, from: e.target.value })} placeholder="Teaching" /></Field>
                                    <Field label="To" htmlFor="about-cc-to"><Input id="about-cc-to" value={answers.careerChange.to} onChange={e => set("careerChange", { ...answers.careerChange, to: e.target.value })} placeholder="Instructional design" /></Field>
                                </div>
                            )}
                        </div>
                        <div className="space-y-3">
                            <Label>Any employment gaps worth explaining?</Label>
                            {gaps.length > 0 && (
                                <p className="text-13 text-fg-muted">
                                    Your library shows {gaps.map(g => `${formatMonthYear(g.from)} – ${formatMonthYear(g.to)} (${g.months} months)`).join(", ")}.
                                </p>
                            )}
                            <YesNo value={answers.gaps.has} onChange={v => set("gaps", { ...answers.gaps, has: v })} />
                            {answers.gaps.has && (
                                <Field label="What happened, and how would you like it framed?" htmlFor="about-gaps">
                                    <Textarea id="about-gaps" rows={2} value={answers.gaps.explanation} onChange={e => set("gaps", { ...answers.gaps, explanation: e.target.value })} placeholder="Caregiving in 2023; kept skills current with an online data course." />
                                </Field>
                            )}
                        </div>
                        <Field label="Top strengths" htmlFor="about-strengths" hint={hint("strengths", "Up to 5 short phrases.")}>
                            <ChipInput id="about-strengths" values={answers.strengths} onChange={v => set("strengths", v)} placeholder="Backend systems" max={5} />
                        </Field>
                        <div className="grid gap-4 md:grid-cols-2">
                            <Field label="Emphasize" htmlFor="about-emph" hint="What should stand out?">
                                <Textarea id="about-emph" rows={3} value={answers.emphasize} onChange={e => set("emphasize", e.target.value)} placeholder="Leading the payments migration; open-source work." />
                            </Field>
                            <Field label="Play down" htmlFor="about-deemph" hint="What should take less space?">
                                <Textarea id="about-deemph" rows={3} value={answers.deEmphasize} onChange={e => set("deEmphasize", e.target.value)} placeholder="Retail jobs from before university." />
                            </Field>
                        </div>
                    </CardBody>
                </Card>
            )}

            {step === "follow-ups" && (
                <Card>
                    <CardHeader
                        title="A few questions from your coach"
                        hint="Written for your answers. Skip any you like."
                        action={<Button size="sm" variant="ghost" icon={Sparkles} onClick={() => void generateQuestions()} loading={writingQuestions} disabled={busy !== null}>New questions</Button>}
                    />
                    <CardBody className="space-y-4">
                        {writingQuestions && followUps.length === 0 && <p className="text-13 text-fg-subtle">Writing questions…</p>}
                        {!writingQuestions && followUps.length === 0 && <p className="text-13 text-fg-subtle">No questions yet. Press New questions, or finish without them.</p>}
                        {followUps.map((f, i) => (
                            <Field key={f.id} label={f.question} htmlFor={`about-fu-${f.id}`} hint={f.why || undefined}>
                                <Textarea
                                    id={`about-fu-${f.id}`} rows={2} value={f.answer}
                                    onChange={e => setFollowUps(prev => prev.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))}
                                />
                            </Field>
                        ))}
                    </CardBody>
                </Card>
            )}

            <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center">
                {saved.status !== "complete" && (
                    <Button variant="ghost" onClick={() => void skip()} loading={busy === "skip"} disabled={busy !== null && busy !== "skip"}>Skip for now</Button>
                )}
                <div className="flex flex-col-reverse gap-2 sm:ml-auto sm:flex-row">
                    <Button variant="ghost" onClick={() => void save("draft")} loading={busy === "draft"} disabled={busy !== null && busy !== "draft"}>Save draft</Button>
                    {stepIndex > 0 && <Button onClick={() => goTo(STEPS[stepIndex - 1].value)}>Back</Button>}
                    {stepIndex < STEPS.length - 1 ? (
                        <Button variant="primary" onClick={() => goTo(STEPS[stepIndex + 1].value)}>Next</Button>
                    ) : (
                        <Button variant="primary" onClick={() => void save("complete")} loading={busy === "finish"} disabled={!canFinish || (busy !== null && busy !== "finish")} title={canFinish ? undefined : "Add your field or a target position first"}>
                            {saved.status === "complete" ? "Save" : "Finish"}
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}

function YesNo({ value, onChange }: { value: boolean | null; onChange: (v: boolean | null) => void }) {
    return (
        <Segmented<"yes" | "no" | "unset">
            value={value === null ? "unset" : value ? "yes" : "no"}
            onChange={v => onChange(v === "unset" ? null : v === "yes")}
            options={[{ value: "no", label: "No" }, { value: "yes", label: "Yes" }, { value: "unset", label: "Skip" }]}
            className={cn("w-fit")}
        />
    );
}
