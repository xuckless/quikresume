// src/components/start/start-flow.tsx
"use client";

// /start: the signed-out funnel. Import (or a sample) -> field + target role -> template (real Typst
// preview) -> paste a job -> teaser score, then Google sign-in. Everything stays in this browser
// (lib/guest/draft-store.ts) until the dashboard claims it after sign-in.

import { useFormsOperation } from "@/lib/ui/use-forms-operation";
import React, { useRef, useState } from "react";
import { guestDraftStore, EMPTY_GUEST_DRAFT, type GuestDraft } from "@/lib/guest/draft-store";
import { demoSamples } from "@/lib/demo/samples";
import { documentFormData } from "@/lib/import/pdf-pages";
import { MAX_FILE_BYTES, type ImportResponse } from "@/lib/import/types";
import { applyTags } from "@/lib/tags/content";
import { scoreJob } from "@/lib/match/score";
import { readJson } from "@/lib/ui/fetch-json";
import { signInFromStartAction } from "@/app/actions/auth-actions";
import type { ResumeTheme } from "@/lib/layout/theme";
import type { Requirement } from "@/lib/match/types";
import type { Seniority } from "@/lib/match/seniority";
import type { ResumeData } from "@/types/schema";
import { cn } from "@/lib/cn";
import { Button, Card, CardBody, Field, Input, NoticeBanner, Textarea } from "@/components/ui/primitives";
import { ScoreRing } from "@/components/ui/primitives/score-ring";
import { Upload } from "@/components/ui/primitives/icons";
import { Turnstile, type TurnstileHandle } from "./turnstile";
import dynamic from "next/dynamic";

const ResumePreview = dynamic(() => import("@/components/ui/resume-preview").then(m => m.ResumePreview), {
    ssr: false,
    loading: () => <p className="p-6 text-13 text-fg-muted">Loading the preview engine…</p>,
});

const ACCEPT = ".pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp";
const STEPS: { id: GuestDraft["step"]; label: string }[] = [
    { id: "import", label: "Import" }, { id: "profile", label: "About you" }, { id: "template", label: "Template" },
    { id: "job", label: "Job" }, { id: "teaser", label: "Your match" },
];
const FIELDS = ["Software engineering", "Nursing", "Accounting & finance", "Teaching", "Skilled trades", "Sales & marketing", "Design", "Law", "Other"];
const SAMPLE_FIELD: Record<string, string> = { software: "Software engineering", nursing: "Nursing", accounting: "Accounting & finance", electrician: "Skilled trades" };

function Steps({ current }: { current: GuestDraft["step"] }) {
    const at = STEPS.findIndex(s => s.id === current);
    return (
        <ol className="flex flex-wrap gap-x-4 gap-y-1 text-13" aria-label="Progress">
            {STEPS.map((s, i) => (
                <li key={s.id} aria-current={i === at ? "step" : undefined} className={cn("flex items-center gap-1.5", i === at ? "font-medium text-fg" : i < at ? "text-accent-text" : "text-fg-subtle")}>
                    <span className={cn("flex size-5 items-center justify-center rounded-full font-mono text-[11px]", i === at ? "bg-accent text-accent-fg" : "bg-surface-muted")}>{i + 1}</span>
                    {s.label}
                </li>
            ))}
        </ol>
    );
}

export function StartFlow() {
    const draft = guestDraftStore.useValue();
    const set = (patch: Partial<GuestDraft>) => guestDraftStore.set(d => ({ ...d, ...patch }));
    const turnstile = useRef<TurnstileHandle>(null);
    const operation = useFormsOperation<{ kind: "upload" | "match"; label: string }>();
    const busy = operation.state.status === "running" ? operation.state.operation.label : null;
    const error = operation.state.status === "failed" ? operation.state.error : null;
    const [jdText, setJdText] = useState("");

    const upload = async (file: File) => {
        const id = operation.begin({ kind: "upload", label: "Reading your résumé… (10–40 s)" });
        if (id === null) return;
        if (file.size > MAX_FILE_BYTES) { operation.fail(id, "That file is over 10 MB."); return; }
        try {
            const form = await documentFormData(file, label => operation.progress(id, { kind: "upload", label }));
            form.append("turnstile", (await turnstile.current?.take()) ?? "");
            if (!operation.active(id)) return;
            operation.progress(id, { kind: "upload", label: "Reading your résumé… (10–40 s)" });
            const json = await readJson<ImportResponse>(await fetch("/api/guest/import", { method: "POST", body: form }));
            if (!json.ok) throw new Error(json.error);
            if (!operation.active(id)) return;
            operation.succeed(id, undefined);
            set({ resume: json.data, source: "upload", fileName: json.fileName, step: "profile", job: null });
        } catch (err) {
            operation.fail(id, err instanceof Error ? err.message : "Could not read that file.");
        }
    };

    const loadSample = (id: string) => {
        operation.reset();
        const s = demoSamples().find(x => x.id === id);
        if (!s) return;
        set({ resume: s.resume, source: "sample", fileName: "", field: SAMPLE_FIELD[id] ?? "", role: s.job.title, step: "profile", job: null });
        setJdText("");
    };

    const match = async () => {
        if (!draft.resume) return;
        const id = operation.begin({ kind: "match", label: "Reading the posting and matching… (15–40 s)" });
        if (id === null) return;
        try {
            const res = await fetch("/api/guest/match", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ jdText, resume: draft.resume, field: draft.field, turnstile: (await turnstile.current?.take()) ?? "" }),
            });
            const json = await readJson<{ title: string; company: string; requirements: Requirement[]; seniority: Seniority | null; companyDomain: string | null; tagsById: Record<string, ResumeData["profileTags"]> }>(res);
            if (!json.ok || !json.requirements) throw new Error(json.error ?? "Could not match that job.");
            if (!operation.active(id)) return;
            operation.succeed(id, undefined);
            set({
                resume: applyTags(draft.resume, json.tagsById ?? {}),
                job: { title: json.title ?? "This job", company: json.company ?? "", jdText, requirements: json.requirements, seniority: json.seniority ?? null, companyDomain: json.companyDomain ?? null },
                step: "teaser",
            });
        } catch (err) {
            operation.fail(id, err instanceof Error ? err.message : "Could not match that job.");
        }
    };

    const changeTheme = (theme: ResumeTheme) => {
        if (!draft.resume) return;
        set({ resume: { ...draft.resume, layout: { ...draft.resume.layout, theme } } });
    };

    const back = (step: GuestDraft["step"]) => () => { operation.reset(); set({ step }); };

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <Steps current={draft.step} />
                {draft.resume && <Button size="sm" variant="ghost" onClick={() => { operation.reset(); guestDraftStore.set(EMPTY_GUEST_DRAFT); setJdText(""); }}>Start over</Button>}
            </div>
            {error && <NoticeBanner tone="danger" onDismiss={() => operation.reset()}>{error}</NoticeBanner>}

            {draft.step === "import" && (
                <div className="space-y-5">
                    <div>
                        <h1 className="text-3xl font-semibold tracking-tight">Start by importing your résumé</h1>
                        <p className="mt-2 text-fg-muted">We read it into an editable library. Nothing is saved to an account until you sign in; it stays in this browser.</p>
                    </div>
                    <label className={cn("flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border-strong bg-surface p-10 text-center transition-colors hover:border-accent", busy && "pointer-events-none opacity-70")}>
                        <span className="flex size-12 items-center justify-center rounded-lg bg-accent text-accent-fg"><Upload className="size-5" aria-hidden /></span>
                        <span className="text-lg font-medium text-fg">{busy ?? "Choose a PDF, Word or text file"}</span>
                        <span className="text-13 text-fg-muted">Up to 10 MB. Scanned PDFs and photos work too.</span>
                        <input type="file" accept={ACCEPT} className="sr-only" disabled={Boolean(busy)} onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
                    </label>
                    <div className="text-13 text-fg-muted">
                        No résumé handy? Try a sample:{" "}
                        {demoSamples().map((s, i) => (
                            <React.Fragment key={s.id}>{i > 0 && " · "}<button type="button" className="text-accent-text underline underline-offset-2" onClick={() => loadSample(s.id)}>{s.label}</button></React.Fragment>
                        ))}
                    </div>
                </div>
            )}

            {draft.step === "profile" && draft.resume && (
                <Card>
                    <CardBody className="space-y-4">
                        <div>
                            <h1 className="text-2xl font-semibold tracking-tight">
                                {draft.source === "upload" ? `Read ${draft.resume.workExperience.length} roles, ${draft.resume.education.length} education entries and ${draft.resume.skills.length} skill groups.` : "Sample loaded."}
                            </h1>
                            <p className="mt-1 text-fg-muted">Two quick questions so skills are read the way your field reads them.</p>
                        </div>
                        <Field label="Your field" htmlFor="start-field">
                            <Input id="start-field" list="start-fields" value={draft.field} onChange={e => set({ field: e.target.value.slice(0, 80) })} placeholder="Nursing" />
                            <datalist id="start-fields">{FIELDS.map(f => <option key={f} value={f} />)}</datalist>
                        </Field>
                        <Field label="Role you're applying for" htmlFor="start-role">
                            <Input id="start-role" value={draft.role} onChange={e => set({ role: e.target.value.slice(0, 120) })} placeholder="Registered Nurse, ICU" />
                        </Field>
                        <div className="flex justify-between">
                            <Button variant="ghost" onClick={back("import")}>Back</Button>
                            <Button variant="primary" onClick={() => set({ step: "template" })}>Next: pick a template</Button>
                        </div>
                    </CardBody>
                </Card>
            )}

            {draft.step === "template" && draft.resume && (
                <div className="space-y-4">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                        <div>
                            <h1 className="text-2xl font-semibold tracking-tight">Pick a template</h1>
                            <p className="mt-1 text-fg-muted">This is the real PDF engine. Use the template menu and Style for accent, fonts and paper size.</p>
                        </div>
                        <div className="flex gap-2">
                            <Button variant="ghost" onClick={back("profile")}>Back</Button>
                            <Button variant="primary" onClick={() => set({ step: "job" })}>Next: paste a job</Button>
                        </div>
                    </div>
                    <div className="h-[75vh] overflow-hidden rounded-lg border border-border">
                        <ResumePreview resumeData={draft.resume} hideDownload onThemeChange={changeTheme} />
                    </div>
                </div>
            )}

            {draft.step === "job" && draft.resume && (
                <Card>
                    <CardBody className="space-y-4">
                        <div>
                            <h1 className="text-2xl font-semibold tracking-tight">Paste a job you&apos;re interested in</h1>
                            <p className="mt-1 text-fg-muted">The whole posting works best: title, requirements and nice-to-haves.</p>
                        </div>
                        <Textarea rows={12} value={jdText} onChange={e => setJdText(e.target.value)} placeholder="Paste the job description here…" aria-label="Job description" />
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <Button variant="ghost" onClick={back("template")}>Back</Button>
                            <Button variant="primary" loading={Boolean(busy)} disabled={jdText.trim().length < 40} onClick={() => void match()}>{busy ?? "See my match"}</Button>
                        </div>
                    </CardBody>
                </Card>
            )}

            {draft.step === "teaser" && draft.resume && draft.job && <Teaser draft={draft} onBack={back("job")} />}

            <Turnstile ref={turnstile} />
        </div>
    );
}

function Teaser({ draft, onBack }: { draft: GuestDraft; onBack: () => void }) {
    const job = draft.job!;
    const m = scoreJob(job.requirements, draft.resume!, {}, { seniority: job.seniority ?? null });
    const missing = m.rows.filter(r => r.strength < 0.3).length;
    return (
        <Card>
            <CardBody className="space-y-6">
                <div>
                    <p className="text-13 text-fg-subtle">Your match for</p>
                    <h1 className="text-2xl font-semibold tracking-tight">{job.title}{job.company && <span className="text-fg-muted"> · {job.company}</span>}</h1>
                </div>
                <div className="flex flex-wrap items-center gap-6">
                    <ScoreRing score={m.score} size={96} showBand />
                    <div className="space-y-1 text-13">
                        <p className="font-mono tabular-nums text-fg-muted">{m.score} <span className="text-fg-subtle">±{m.band}</span></p>
                        <p className="text-base font-medium text-fg">Must-haves {m.must.hit} of {m.must.total} covered</p>
                        <p className="text-fg-muted">{missing > 0 ? `${missing} requirement${missing === 1 ? "" : "s"} your résumé doesn't show yet.` : "Every requirement shows up on your résumé."}</p>
                        <p className="text-xs text-fg-subtle">A quick first read on skill keywords. The full review also checks meaning, years and titles.</p>
                    </div>
                </div>

                <div className="relative">
                    <div aria-hidden className="pointer-events-none select-none space-y-2 blur-[5px]">
                        {m.rows.slice(0, 7).map(r => (
                            <div key={r.requirement.name} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-13">
                                <span>{r.requirement.display}</span>
                                <span className="font-mono">{Math.round(r.strength * 100)}</span>
                            </div>
                        ))}
                    </div>
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-bg/40 p-4 text-center">
                        <p className="max-w-md text-base font-medium text-fg">Sign in to see the full review: which line proves each requirement, what&apos;s missing, and exactly what would raise your score.</p>
                        <form action={signInFromStartAction}>
                            <Button type="submit" variant="primary">Sign in with Google to see the full review</Button>
                        </form>
                        <p className="text-xs text-fg-muted">{draft.source === "upload" ? "After sign-in, we’ll add your imported résumé if you don’t already have a library, and save this job to your Job Tracker." : "This job will be added to your Job Tracker after sign-in."}</p>
                    </div>
                </div>
                <Button variant="ghost" onClick={onBack}>Try another job</Button>
            </CardBody>
        </Card>
    );
}
