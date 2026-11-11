// src/components/ui/job-match-view.tsx
"use client";

// Job Match: analyse a job description, score a resume source against it
// (working selection / saved variant / uploaded resume), follow the guidelines,
// inspect the ATS keyword table, and tailor the résumé (tailor-dialog.tsx). The AI proposals
// card is hidden (SHOW_SUGGESTIONS).

import { jobDetailDialogTransition, type JobDetailDialog } from "@/lib/ui/job-detail-state";
import { useJobOperation } from "@/lib/ui/job-use-operation";
import React, { useEffect, useReducer, useState } from "react";
import { useRouter } from "next/navigation";
import type { ResumeData } from "@/types/schema";
import type { ResumeVariant } from "@/types/db";
import { JOB_STATUS_LABEL, JOB_STATUSES, type JobRecord, type JobStatus, type MuteRule, type Preferences, type Proposal, type Requirement, type ResumeSource } from "@/lib/match/types";
import type { AliasMap } from "@/lib/tags/normalize";
import { requirementTier, scoreJob, scoreOptionsFor, uncoveredRequirements } from "@/lib/match/score";
import { contradictsMeasuredLevel } from "@/lib/match/seniority";
import { muteRuleFor } from "@/lib/match/proposals";
import { applyTags, allInputs, tagContext } from "@/lib/tags/content";
import { kindMeta } from "@/lib/tags/types";
import { applyVariant } from "@/lib/variants";
import { documentFormData } from "@/lib/import/pdf-pages";
import { MAX_FILE_BYTES, type ImportResponse } from "@/lib/import/types";
import { RESUME_LIST_KEYS } from "@/types/schema";
import { SECTION_LABEL } from "@/lib/sections";
import { deleteJob, muteProposal, renameJob, saveJobScore, setJobStatus, setProposalStatus, unmuteProposal, saveCaps, updateJobMeta } from "@/app/actions/job-actions";
import { cn } from "@/lib/cn";
import { Button, FOCUS_RING, IconButton } from "@/components/ui/primitives/button";
import { Field, Input, Select, Textarea } from "@/components/ui/primitives/field";
import { ConfirmDialog } from "@/components/ui/primitives/dialog";
import { ProposalCards } from "@/components/ui/proposal-cards";
import { EvidenceTable, ScoreHeadline, SubScoreBars, WhatIfList } from "@/components/ui/job-match/match-breakdown";
import { Segmented } from "@/components/ui/primitives/segmented";
import { GuidelineRow } from "@/components/ui/primitives/guideline-row";
import { Card, CardBody, CardHeader } from "@/components/ui/primitives/card";
import { Badge } from "@/components/ui/primitives/badge";
import { NoticeBanner } from "@/components/ui/primitives/notice-banner";
import { ChevronDown } from "@/components/ui/primitives/icons";
import { useResumePageCount } from "@/components/ui/use-page-count";
import { Dialog } from "@/components/ui/primitives/dialog";
import { ArrowLeft, ExternalLink, Loader2, PenLine, Wand2 } from "@/components/ui/primitives/icons";
import { TrackerView } from "@/components/ui/job-tracker/tracker-view";
import { TailorDialog } from "@/components/ui/job-match/tailor-dialog";
import { SkillQuestions } from "@/components/ui/job-match/skill-questions";
import { readJson } from "@/lib/ui/fetch-json";

/** The Suggestions card (AI proposals) is hidden from the UI; its code paths stay for later. */
const SHOW_SUGGESTIONS = false;
/** How often the job page polls the job status while a background reconcile runs. */
const MATCH_POLL_MS = 4000;
const MATCH_POLL_MAX_FAILURES = 6;

export interface ExternalResume {
    fileName: string;
    data: ResumeData;
}

interface JobMatchViewProps {
    jobs: JobRecord[];
    preferences: Preferences;
    aliases: AliasMap;
    variants: ResumeVariant[];
    /** Working selection (server truth; the editor draft never leaks outside the editor). */
    resumeData: ResumeData;
    selectedJobId: string | null;
    onSelectJob: (id: string | null) => void;
    onApplyProposal: (job: JobRecord, p: Proposal) => Promise<void>;
    onImportExternal: (r: ExternalResume) => void;
    externalResume: ExternalResume | null;
    onExternalResume: (r: ExternalResume | null) => void;
}

import { jobOperationTransition, type JobOperationState } from "@/lib/ui/job-operation-state";
import { deleteTransition } from "@/lib/ui/job-delete-state";
import { analysisDialogTransition } from "@/lib/ui/job-analysis-dialog";

export function JobMatchView(props: JobMatchViewProps) {
    const { jobs, selectedJobId, onSelectJob } = props;
    const router = useRouter();
    const [error, setError] = useState<string | null>(null);
    const [deletion, dispatchDelete] = useReducer(deleteTransition, { status: "closed" });
    const pendingDelete = deletion.status === "closed" ? null : deletion.job;
    const deleting = deletion.status === "deleting";
    const deleteError = deletion.status === "failed" ? deletion.message : null;
    const setPendingDelete = (job: JobRecord) => dispatchDelete({ type: "open", job });
    const [analysisDialog, sendAnalysisDialog] = useReducer(analysisDialogTransition, { phase: "closed" });
    const selected = jobs.find(j => j.id === selectedJobId) ?? null;

    return (
        // Container queries, not viewport breakpoints: the width left over depends on the sidebar and the resizable preview pane.
        <div className="@container space-y-4">
            {error && <NoticeBanner tone="danger" onDismiss={() => setError(null)}>{error}</NoticeBanner>}
            {selected ? (
                <section className="@container min-w-0 space-y-4">
                    <Button size="sm" variant="ghost" icon={ArrowLeft} onClick={() => onSelectJob(null)}>All jobs</Button>
                    <JobDetail key={selected.id} job={selected} {...props} onDelete={() => setPendingDelete(selected)} onError={setError} />
                </section>
            ) : (
                <TrackerView jobs={jobs} onOpen={onSelectJob} onAnalyse={() => sendAnalysisDialog({ type: "open" })} onDelete={setPendingDelete} />
            )}

            <Dialog open={analysisDialog.phase !== "closed"} onClose={() => sendAnalysisDialog({ type: "close" })} title="Analyse a job" description="Paste a job description or upload it. We extract its requirements and score your résumé against them.">
                <AnalyzeForm
                    resumeData={props.resumeData}
                    onAnalyzed={(job) => { sendAnalysisDialog({ type: "analyzed" }); onSelectJob(job.id); router.refresh(); }}
                    onBusyChange={busy => sendAnalysisDialog({ type: busy ? "processing" : "settled" })}
                />
            </Dialog>

            <ConfirmDialog
                open={pendingDelete !== null}
                title={`Delete "${pendingDelete?.title ?? "job"}"?`}
                confirmLabel="Delete"
                danger
                busy={deleting}
                onCancel={() => dispatchDelete({ type: "cancel" })}
                onConfirm={async () => {
                    if (!pendingDelete || deleting) return;
                    dispatchDelete({ type: "start" });
                    try {
                        await deleteJob(pendingDelete.id);
                        if (selectedJobId === pendingDelete.id) onSelectJob(null);
                        dispatchDelete({ type: "complete" });
                        router.refresh();
                    } catch (err) {
                        dispatchDelete({ type: "fail", message: err instanceof Error ? err.message : "Could not delete the job." });
                    }
                }}
            >
                <p>The analysis, its suggestions and the tracker entry are removed. Your library is not affected.</p>
                {deleteError && <p role="alert" className="text-danger">{deleteError}</p>}
            </ConfirmDialog>
        </div>
    );
}

// ---------- Analyse form

const ACCEPT = ".pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp";

function AnalyzeForm({ resumeData, onAnalyzed, onBusyChange }: { resumeData: ResumeData; onAnalyzed: (job: JobRecord) => void; onBusyChange: (busy: boolean) => void }) {
    const [text, setText] = useState("");
    const [file, setFile] = useState<File | null>(null);
    const [analysis, dispatchAnalysis] = useReducer(jobOperationTransition<"preparing" | "extracting">, { status: "idle" } as JobOperationState<"preparing" | "extracting">);
    const busy = analysis.status === "running" ? (analysis.operation === "preparing" ? "Preparing file…" : "Extracting requirements…") : null;
    const error = analysis.status === "failed" ? analysis.message : null;
    const setError = (message: string) => dispatchAnalysis({ type: "fail", message });
    const begin = (operation: "preparing" | "extracting") => {
        dispatchAnalysis({ type: "start", operation });
        onBusyChange(true);
    };

    const submit = async () => {
        if (busy) return;
        try {
            let body: FormData;
            if (text.trim()) {
                body = new FormData();
                body.set("text", text);
            } else if (file) {
                begin("preparing");
                body = await documentFormData(file);
            } else return;
            // The working selection rides along so the server can reconcile the requirements
            // against the whole library (semantic matches: degree levels, implied skills, fields).
            body.set("resume", JSON.stringify(resumeData));
            if (file && !text.trim()) dispatchAnalysis({ type: "advance", operation: "extracting" });
            else begin("extracting");
            const res = await fetch("/api/jobs/analyze", { method: "POST", body });
            const json = (await res.json().catch(() => null)) as { ok: boolean; error?: string; job?: JobRecord } | null;
            if (!json) throw new Error(`Analysis failed (${res.status}).`);
            if (!json.ok || !json.job) throw new Error(json.error ?? "Analysis failed.");
            setText("");
            setFile(null);
            onAnalyzed(json.job);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Analysis failed.");
        } finally {
            dispatchAnalysis({ type: "complete" });
            onBusyChange(false);
        }
    };

    return (
        <div className="space-y-3">
                <Textarea value={text} onChange={e => setText(e.target.value)} rows={7} placeholder="Paste the job description here…" disabled={busy !== null} />
                <div className="flex items-center gap-3 text-xs text-fg-subtle">
                    <span className="h-px flex-1 bg-border" />or upload<span className="h-px flex-1 bg-border" />
                </div>
                <label className={cn("block cursor-pointer rounded-md border border-dashed px-3 py-2.5 text-center text-13 transition-colors", file ? "border-border-strong text-fg" : "border-border-strong text-fg-muted hover:border-fg-subtle")}>
                    <input
                        type="file"
                        accept={ACCEPT}
                        className="sr-only"
                        disabled={busy !== null}
                        onChange={e => {
                            const f = e.target.files?.[0] ?? null;
                            if (f && f.size > MAX_FILE_BYTES) { dispatchAnalysis({ type: "invalid", message: "That file is over 10 MB." }); return; }
                            setFile(f);
                            e.target.value = "";
                        }}
                    />
                    {file ? file.name : "PDF · DOCX · TXT · image"}
                </label>
                {error && <p role="alert" className="text-13 text-danger">{error}</p>}
                <Button variant="primary" className="w-full" onClick={submit} disabled={!text.trim() && !file} loading={busy !== null}>
                    {busy ?? "Analyse"}
                </Button>
        </div>
    );
}

// ---------- Job detail

type DetailProps = JobMatchViewProps & { job: JobRecord; onDelete: () => void; onError: (e: string | null) => void };

function JobDetail({ job, preferences, aliases, variants, resumeData, onApplyProposal, onImportExternal, externalResume, onExternalResume, onDelete, onError }: DetailProps) {
    const router = useRouter();
    const [source, setSource] = useState<ResumeSource>(externalResume ? { kind: "upload", fileName: externalResume.fileName } : { kind: "selection" });
    const [proposals, setProposals] = useState<Proposal[]>(job.proposals);
    const [muted, setMuted] = useState<MuteRule[]>(preferences.mutedProposals);
    const [caps, setCaps] = useState(preferences.caps);
    const detailOperation = useJobOperation<"recheck" | "suggest" | `apply:${string}` | "reading" | "tagging">();
    const busy = detailOperation.state.status === "running" ? detailOperation.state.operation : null;
    const uploading = busy === "reading" ? "Reading resume…" : busy === "tagging" ? "Analysing skills…" : null;
    const detailError = detailOperation.state.status === "failed" ? detailOperation.state.message : null;
    useEffect(() => { if (detailError) onError(detailError); }, [detailError, onError]);
    const [showAts, setShowAts] = useState(true);
    const [showCaps, setShowCaps] = useState(false);

    const variant = source.kind === "variant" ? variants.find(v => v.id === source.variantId) ?? null : null;
    const resume: ResumeData =
        source.kind === "upload" && externalResume ? externalResume.data
        : variant ? applyVariant(resumeData, variant.items, variant.hidden)
        : resumeData;
    const match = scoreJob(job.requirements, resume, aliases, scoreOptionsFor(job));
    const { pages, error: pageError } = useResumePageCount(resume);
    const reqDisplay = (name: string) => job.requirements.find(r => r.name === name)?.display ?? name;

    const uploadResume = async (file: File) => {
        const run = detailOperation.start("reading");
        if (!run) return;
        onError(null);
        try {
            if (file.size > MAX_FILE_BYTES) throw new Error("That file is over 10 MB.");

            const res = await fetch("/api/import", { method: "POST", body: await documentFormData(file) });
            const json = (await res.json().catch(() => null)) as ImportResponse | null;
            if (!json) throw new Error(`Import failed (${res.status}).`);
            if (!json.ok) throw new Error(json.error);
            if (!run.active()) return;
            run.advance("tagging");
            const tagRes = await fetch("/api/tags/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: allInputs(json.data), context: tagContext(json.data) }) });
            const tagJson = (await tagRes.json().catch(() => null)) as { ok: boolean; error?: string; tagsById?: Record<string, ResumeData["profileTags"]> } | null;
            if (!tagJson?.ok) throw new Error(tagJson?.error ?? "Skill analysis failed.");
            if (!run.active()) return;
            const data = applyTags(json.data, tagJson.tagsById ?? {});
            onExternalResume({ fileName: json.fileName, data });
            setSource({ kind: "upload", fileName: json.fileName });
        } catch (err) {
            if (!run.active()) return;
            run.fail(err instanceof Error ? err.message : "Could not read that resume.");
        } finally {
            run.complete();
        }
    };

    /** Re-runs the broader-context pass against the resume being scored (any source). */
    const recheck = async () => {
        const run = detailOperation.start("recheck");
        if (!run) return;
        onError(null);

        try {
            const res = await fetch("/api/jobs/reconcile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: job.id, resume }) });
            const json = (await res.json().catch(() => null)) as { ok: boolean; error?: string } | null;
            if (!json?.ok) throw new Error(json?.error ?? "The AI match check failed.");
            // The pass itself runs in the background; the refresh picks up "running" and starts the poll.
            router.refresh();
        } catch (err) {
            if (!run.active()) return;
            run.fail(err instanceof Error ? err.message : "The AI match check failed.");
        } finally {
            run.complete();
        }
    };

    const getSuggestions = async () => {
        const run = detailOperation.start("suggest");
        if (!run) return;
        onError(null);

        try {
            const res = await fetch("/api/jobs/proposals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: job.id, resume }) });
            const json = (await res.json().catch(() => null)) as { ok: boolean; error?: string; proposals?: Proposal[] } | null;
            if (!json?.ok || !json.proposals) throw new Error(json?.error ?? "Could not get suggestions.");
            if (!run.active()) return;
            setProposals(json.proposals);
            router.refresh();
        } catch (err) {
            if (!run.active()) return;
            run.fail(err instanceof Error ? err.message : "Could not get suggestions.");
        } finally {
            run.complete();
        }
    };

    const setStatus = async (p: Proposal, status: Proposal["status"]) => {
        setProposals(prev => prev.map(x => (x.id === p.id ? { ...x, status } : x)));
        try {
            await setProposalStatus(job.id, p.id, status);
        } catch (err) {
            onError(err instanceof Error ? err.message : "Could not update the suggestion.");
        }
    };

    const apply = async (p: Proposal) => {
        if (source.kind === "upload") { onError("Suggestions can only be applied to your own library. Import the uploaded resume first."); return; }
        const run = detailOperation.start(`apply:${p.id}`);
        if (!run) return;
        try {
            await onApplyProposal(job, p);
            await setStatus(p, "applied");
        } catch (err) {
            if (!run.active()) return;
            run.fail(err instanceof Error ? err.message : "Could not apply the suggestion.");
        } finally {
            run.complete();
        }
    };

    const ignoreSimilar = async (p: Proposal) => {
        const rule = muteRuleFor(p);
        setMuted(prev => [...prev, rule]);
        await setStatus(p, "ignored");
        try { await muteProposal(rule); } catch (err) { onError(err instanceof Error ? err.message : "Could not save the rule."); }
    };

    const unmute = async (rule: MuteRule) => {
        setMuted(prev => prev.filter(r => !(r.kind === rule.kind && (r.tag ?? "") === (rule.tag ?? "") && (r.itemId ?? "") === (rule.itemId ?? ""))));
        try { await unmuteProposal(rule); } catch (err) { onError(err instanceof Error ? err.message : "Could not update the rule."); }
    };

    // Library-wide (every item on): requirements answered "No" in the questionnaire that this job needs.
    const declinedNames = new Set(preferences.declinedSoftSkills.map(d => d.name));
    const declinedNeeded = uncoveredRequirements(job.requirements, resumeData, aliases).filter(r => declinedNames.has(r.name));
    const [detailDialog, changeDetailDialog] = useReducer(jobDetailDialogTransition, "closed" as JobDetailDialog);
    const [editingTitle, setEditingTitle] = useState<string | null>(null);

    const commitTitle = async () => {
        const next = editingTitle?.trim();
        setEditingTitle(null);
        if (!next || next === job.title) return;
        try {
            await renameJob(job.id, next);
            router.refresh();
        } catch (err) {
            onError(err instanceof Error ? err.message : "Could not rename the job.");
        }
    };

    // Remember the working selection's score for the job list (debounced; writes nothing when unchanged).
    // Not while the AI check runs: the tracker would show the preliminary keyword score as final.
    const matchRunning = job.match.status === "running";
    const roundedScore = Math.round(match.score);
    const scoreToSave = source.kind === "selection" && !matchRunning && roundedScore !== job.lastScore ? roundedScore : null;
    useEffect(() => {
        if (scoreToSave === null) return;
        const timer = setTimeout(() => { void saveJobScore(job.id, scoreToSave).catch(() => {}); }, 1500);
        return () => clearTimeout(timer);
    }, [job.id, scoreToSave]);
    const [notice, setNotice] = useState<string | null>(null);

    // Background reconcile (usually well under a minute, at most ~5): poll the job's status (one document
    // read) and refresh once it stops running. The server reads an expired run as "failed", so the poll ends
    // there; it also ends when the job is gone (404) or after MATCH_POLL_MAX_FAILURES failed polls in a row.
    const runningUntil = job.match.runningUntil;
    useEffect(() => {
        if (!matchRunning) return;
        let stopped = false;
        let failures = 0;
        const stop = () => { stopped = true; clearInterval(timer); router.refresh(); };
        const timer = setInterval(async () => {
            const res = await fetch(`/api/jobs/reconcile?jobId=${encodeURIComponent(job.id)}`).catch(() => null);
            if (stopped) return;
            if (res?.status === 404) return stop();
            const reply = res ? await readJson<{ status: string }>(res) : null;
            if (stopped) return;
            if (!reply?.ok) {
                // A failed poll (network, cold start) waits for the next tick, but not forever.
                const expired = runningUntil !== null && Date.parse(runningUntil) < Date.now();
                if (++failures >= MATCH_POLL_MAX_FAILURES || expired) stop();
                return;
            }
            failures = 0;
            if (reply.status !== "running") stop();
        }, MATCH_POLL_MS);
        return () => { stopped = true; clearInterval(timer); };
    }, [matchRunning, job.id, runningUntil, router]);
    // Notes about seniority that the measured level shown above already contradicts (older jobs, self-reported years).
    const fitNotes = job.fitNotes.filter(n => !contradictsMeasuredLevel(n, job.seniority, match.seniority?.candidate.level ?? null));

    return (
        <div className="space-y-4">
            {notice && <NoticeBanner tone="success" onDismiss={() => setNotice(null)}>{notice}</NoticeBanner>}
            {matchRunning && (
                <NoticeBanner tone="warning">
                    <span className="inline-flex items-center gap-2">
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                        {job.match.checkedAt
                            ? "Re-checking matches with AI against your whole library. The score below is from the last check and may change; this takes up to a minute."
                            : "Checking matches with AI against your whole library. The score below is preliminary (exact keywords only) and usually goes up; this takes up to a minute."}
                    </span>
                </NoticeBanner>
            )}
            {job.match.status === "failed" && (
                <NoticeBanner tone="warning">
                    {job.match.warning || "The AI match check failed."} Exact keyword matching is shown; use &quot;Re-check with AI&quot; to retry.
                </NoticeBanner>
            )}

            {/* One pane: requirements -> score -> guidelines -> ATS */}
            <Card>
                <CardHeader
                    title={editingTitle !== null ? (
                        <Input
                            autoFocus
                            value={editingTitle}
                            aria-label="Job title"
                            className="h-8 text-[15px] font-semibold"
                            onChange={e => setEditingTitle(e.target.value)}
                            onBlur={() => void commitTitle()}
                            onKeyDown={e => {
                                if (e.key === "Enter") { e.preventDefault(); void commitTitle(); }
                                if (e.key === "Escape") { e.preventDefault(); setEditingTitle(null); }
                            }}
                        />
                    ) : (
                        <span className="inline-flex items-center gap-1">
                            {job.title}
                            <IconButton icon={PenLine} aria-label="Rename job" onClick={() => setEditingTitle(job.title)} className="size-7" />
                        </span>
                    )}
                    hint={<>{job.company || "Unknown company"}{job.source.fileName ? ` · from ${job.source.fileName}` : ""}</>}
                    action={
                        <>
                            <Button size="sm" variant="primary" icon={Wand2} onClick={() => changeDetailDialog("tailor")} title="Pick what goes on your résumé for this job, with AI suggestions">
                                Tailor résumé
                            </Button>
                            <Button size="sm" variant="danger" onClick={onDelete}>Delete</Button>
                        </>
                    }
                />
                <JobTrackingStrip job={job} onError={onError} />
                <CardBody className="space-y-3">
                    {job.summary && <p className="text-13 text-fg-muted">{job.summary}</p>}
                    <RequirementGroups requirements={job.requirements} />
                </CardBody>

                {/* Score */}
                <div className="space-y-5 border-t border-border px-4 py-4">
                    <div className="flex flex-col gap-3 @2xl:flex-row @2xl:items-center @2xl:justify-between">
                        <Segmented
                            value={source.kind}
                            onChange={(k) => {
                                if (k === "selection") setSource({ kind: "selection" });
                                else if (k === "variant") setSource({ kind: "variant", variantId: variants[0]?.id ?? "" });
                                else if (externalResume) setSource({ kind: "upload", fileName: externalResume.fileName });
                                else setSource({ kind: "upload", fileName: "" });
                            }}
                            options={[{ value: "selection", label: "Working selection" }, { value: "variant", label: "Variant" }, { value: "upload", label: "Uploaded résumé" }]}
                        />
                        {source.kind === "variant" && (
                            <Select value={source.variantId} onChange={e => setSource({ kind: "variant", variantId: e.target.value })} className="@2xl:w-56" aria-label="Variant">
                                {variants.length === 0 && <option value="">No variants saved yet</option>}
                                {variants.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                            </Select>
                        )}
                        {source.kind === "upload" && (
                            <div className="flex flex-wrap items-center gap-2">
                                <label className={cn("inline-flex h-8 cursor-pointer items-center rounded-md border border-border bg-surface px-2.5 text-13 font-medium hover:bg-surface-hover", busy && "pointer-events-none opacity-50")}>
                                    <input type="file" accept={ACCEPT} className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) uploadResume(f); e.target.value = ""; }} />
                                    {uploading ?? (externalResume ? `Replace ${externalResume.fileName}` : "Upload a résumé")}
                                </label>
                                {externalResume && <Button size="sm" onClick={() => onImportExternal(externalResume)}>Import into library</Button>}
                            </div>
                        )}
                    </div>

                    {source.kind === "upload" && !externalResume ? (
                        <p className="text-13 text-fg-muted">Upload a résumé to score it against this job. It is not saved unless you import it.</p>
                    ) : (
                        <div className="space-y-5">
                            <div className="flex flex-col gap-5 @2xl:flex-row @2xl:items-center">
                                <ScoreHeadline match={match} provisional={matchRunning ? (job.match.checkedAt ? "recheck" : "first") : false} />
                                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-13">
                                    <dt className="text-fg-subtle">Length</dt>
                                    <dd className={cn("tabular-nums", pages !== null && pages > 1 && "text-warning")}>{pages === null ? (pageError ? "Couldn't measure length" : "…") : `${pages} ${pages === 1 ? "page" : "pages"}${pages > 1 ? " · over one page" : ""}`}</dd>
                                </dl>
                                <div className="@2xl:ml-auto">
                                    <Button size="sm" onClick={recheck} loading={busy === "recheck" || matchRunning} title="Re-run semantic matching and the AI check against your whole library: equivalent degrees, implied skills, related projects.">
                                        Re-check with AI
                                    </Button>
                                </div>
                            </div>
                            <div className="grid gap-6 @3xl:grid-cols-2">
                                <section aria-label="Score breakdown" className="space-y-2">
                                    <h3 className="text-13 font-medium text-fg">Breakdown</h3>
                                    <SubScoreBars subScores={match.subScores} seniority={match.seniority} />
                                </section>
                                <section aria-label="What would raise the score" className="space-y-2">
                                    <h3 className="text-13 font-medium text-fg">What would raise it</h3>
                                    <WhatIfList rows={match.rows} provisional={matchRunning} />
                                </section>
                            </div>
                        </div>
                    )}
                </div>

                {/* Guidelines */}
                <GuidelinesSection
                    missingMust={match.missingMust}
                    keywordGaps={match.keywordGaps}
                    declinedNeeded={declinedNeeded}
                    onAnswerDeclined={() => changeDetailDialog("answers")}
                    showScoreSource={source.kind !== "selection"}
                    fitNotes={fitNotes}
                    provisional={matchRunning}
                />

                {/* Evidence per requirement, collapsible */}
                <div className="border-t border-border">
                    <CardHeader
                        title="Evidence by requirement"
                        hint="Direct = a skill on the item or confirmed by the AI check · Related = an equivalent skill · Semantic = a line that means it · Keyword only = printed but not shown in your work."
                        action={<Button size="sm" variant="ghost" onClick={() => setShowAts(v => !v)} aria-expanded={showAts}>{showAts ? "Hide" : "Show"}<ChevronDown className={cn("size-3.5 transition-transform", showAts && "rotate-180")} /></Button>}
                    />
                    {showAts && <EvidenceTable rows={match.rows} provisional={matchRunning} />}
                </div>
            </Card>

            {/* Suggestions (hidden, see SHOW_SUGGESTIONS) */}
            {SHOW_SUGGESTIONS && <Card>
                <CardHeader
                    title="Suggestions"
                    hint="Include/exclude picks come from keyword coverage under your section limits; rewrites and gaps from the AI coach."
                    action={
                        <>
                            <Button size="sm" variant="ghost" onClick={() => setShowCaps(v => !v)} aria-expanded={showCaps}>Section limits</Button>
                            <Button size="sm" variant="primary" onClick={getSuggestions} loading={busy === "suggest"} disabled={source.kind === "upload" || busy !== null}>
                                {proposals.length ? "Refresh" : "Get suggestions"}
                            </Button>
                        </>
                    }
                />
                <CardBody className="space-y-3">
                    {showCaps && (
                        <CapsEditor caps={caps} onChange={setCaps} onSave={async () => { try { await saveCaps(caps); router.refresh(); } catch (err) { onError(err instanceof Error ? err.message : "Could not save limits."); } }} />
                    )}
                    {source.kind === "upload" && <p className="text-13 text-warning">Suggestions work on your own library. Import the uploaded résumé to get them.</p>}
                    <ProposalCards
                        proposals={proposals}
                        requirementDisplay={reqDisplay}
                        busyId={busy?.startsWith("apply:") ? busy.slice(6) : null}
                        onApply={apply}
                        onSkip={p => setStatus(p, "skipped")}
                        onIgnoreSimilar={ignoreSimilar}
                        onReopen={p => setStatus(p, "open")}
                        muted={muted}
                        onUnmute={unmute}
                    />
                </CardBody>
            </Card>}

            {detailDialog === "tailor" && (
                <TailorDialog
                    job={job}
                    resumeData={resumeData}
                    declined={preferences.declinedSoftSkills}
                    aliases={aliases}
                    caps={caps}
                    onClose={(message) => { changeDetailDialog("closed"); if (message) setNotice(message); }}
                />
            )}

            {detailDialog === "answers" && (
                <Dialog open onClose={() => changeDetailDialog("closed")} size="lg" title="Skills you said you don't have" description="Changed your mind? Add them and the warning goes away.">
                    <SkillQuestions
                        gaps={declinedNeeded}
                        declined={preferences.declinedSoftSkills}
                        library={resumeData}
                        onSkip={() => changeDetailDialog("closed")}
                        skipLabel="Close"
                        onSaved={(r) => { changeDetailDialog("closed"); setNotice(r.warning ? `Saved. ${r.warning}` : "Saved to your library."); router.refresh(); }}
                    />
                </Dialog>
            )}
        </div>
    );
}

// ---------- requirement groups

/** Status, applied date, posting link and notes for one job (the tracker fields). */
function JobTrackingStrip({ job, onError }: { job: JobRecord; onError: (e: string | null) => void }) {
    const router = useRouter();
    const [notes, setNotes] = useState(job.notes);
    const statusOperation = useJobOperation<"save">();
    const dateOperation = useJobOperation<"save">();
    const notesOperation = useJobOperation<"save">();
    const save = async (operation: typeof statusOperation, fn: () => Promise<void>) => {
        const run = operation.start("save");
        if (!run) return;
        try { await fn(); if (run.active()) router.refresh(); }
        catch (err) { if (run.active()) onError(err instanceof Error ? err.message : "Could not save."); }
        finally { run.complete(); }
    };
    return (
        <div className="grid gap-3 border-b border-border px-4 py-3 @2xl:grid-cols-[10rem_10rem_minmax(0,1fr)]">
            <Field label="Status" htmlFor={`status-${job.id}`}>
                <Select id={`status-${job.id}`} value={job.status} disabled={statusOperation.state.status === "running"} onChange={e => void save(statusOperation, () => setJobStatus(job.id, e.target.value as JobStatus))}>
                    {JOB_STATUSES.map(st => <option key={st} value={st}>{JOB_STATUS_LABEL[st]}</option>)}
                </Select>
            </Field>
            <Field label="Applied" htmlFor={`applied-${job.id}`}>
                <Input id={`applied-${job.id}`} type="date" disabled={dateOperation.state.status === "running"} defaultValue={job.appliedAt ?? ""} onBlur={e => {
                    const v = e.target.value || null;
                    if (v !== job.appliedAt) void save(dateOperation, () => updateJobMeta(job.id, { appliedAt: v }));
                }} />
            </Field>
            <Field label="Notes" htmlFor={`notes-${job.id}`} hint={job.url ? undefined : "Private to you."}>
                <div className="flex items-center gap-2">
                    <Input id={`notes-${job.id}`} value={notes} disabled={notesOperation.state.status === "running"} placeholder="Recruiter name, referral, next step…" onChange={e => setNotes(e.target.value)} onBlur={() => {
                        if (notes !== job.notes) void save(notesOperation, () => updateJobMeta(job.id, { notes }));
                    }} />
                    {job.url && (
                        <a href={job.url} target="_blank" rel="noreferrer noopener" className={cn("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 text-13 text-fg-muted hover:bg-surface-hover hover:text-fg", FOCUS_RING)}>
                            <ExternalLink className="size-3.5" aria-hidden />Posting
                        </a>
                    )}
                </div>
            </Field>
        </div>
    );
}

function RequirementGroups({ requirements }: { requirements: Requirement[] }) {
    const order = (a: Requirement, b: Requirement) =>
        (a.importance === b.importance ? 0 : a.importance === "must" ? -1 : 1) || a.display.localeCompare(b.display);
    const groups = [
        { label: "Hard requirements", hint: "Named technologies, tools, degrees and languages. Missing a must-have is disqualifying.", items: requirements.filter(r => requirementTier(r) === "hard").sort(order) },
        { label: "Soft requirements", hint: "Traits, practices and domains. Missing ones are keyword advice.", items: requirements.filter(r => requirementTier(r) === "soft").sort(order) },
    ].filter(g => g.items.length > 0);

    return (
        <div className="space-y-2.5">
            {groups.map(g => (
                <div key={g.label} className="grid gap-1.5 @xl:grid-cols-[9.5rem_minmax(0,1fr)] @xl:gap-3">
                    <p className="pt-px text-xs text-fg-subtle" title={g.hint}>
                        {g.label} <span className="tabular-nums">{g.items.length}</span>
                    </p>
                    <div className="flex flex-wrap gap-1">
                        {g.items.map(r => (
                            <Badge
                                key={r.name}
                                size="xs"
                                tone={r.importance === "must" ? "strong" : "neutral"}
                                title={`${r.importance === "must" ? "Must-have" : "Nice-to-have"} · ${kindMeta(r.kind).label}${r.yearsMin ? ` · ${r.yearsMin}+ years` : ""}`}
                            >
                                {r.display}{r.yearsMin ? <span className="ml-1 opacity-60">{r.yearsMin}y+</span> : null}
                            </Badge>
                        ))}
                    </div>
                </div>
            ))}
            <p className="flex items-center gap-3 text-[11px] text-fg-subtle">
                <span className="inline-flex items-center gap-1"><span className="size-2 rounded-[2px] bg-accent" aria-hidden />must-have</span>
                <span className="inline-flex items-center gap-1"><span className="size-2 rounded-[2px] bg-surface-muted ring-1 ring-border" aria-hidden />nice-to-have</span>
            </p>
        </div>
    );
}

// ---------- guidelines

function GuidelinesSection({ missingMust, keywordGaps, declinedNeeded, onAnswerDeclined, showScoreSource, fitNotes, provisional }: {
    missingMust: Requirement[];
    keywordGaps: Requirement[];
    declinedNeeded: Requirement[];
    onAnswerDeclined: () => void;
    showScoreSource: boolean;
    fitNotes: string[];
    /** The AI check is running: gaps aren't final, so they read as "not found yet". */
    provisional: boolean;
}) {
    const declined = new Set(declinedNeeded.map(r => r.name));
    const gaps = keywordGaps.filter(r => !declined.has(r.name));
    const empty = missingMust.length === 0 && gaps.length === 0 && declinedNeeded.length === 0 && fitNotes.length === 0;
    return (
        <div className="border-t border-border">
            <CardHeader title="Guidelines" hint={showScoreSource ? "For the résumé being scored above." : "For your working selection."} />
            <CardBody className="space-y-3 text-13">
                {empty && !provisional && <p className="text-fg-muted">Nothing missing. Every requirement is covered by the résumé above.</p>}
                {provisional && (missingMust.length > 0 || gaps.length > 0) && (
                    <p className="text-fg-muted">The AI check is still looking for the requirements below in your work; this list usually shrinks.</p>
                )}
                {fitNotes.length > 0 && (
                    <GuidelineRow tone="warning" label="Fit with your goals">
                        <ul className="space-y-1">{fitNotes.map(n => <li key={n}>{n}</li>)}</ul>
                    </GuidelineRow>
                )}
                {missingMust.length > 0 && (
                    <GuidelineRow tone={provisional ? "warning" : "danger"} label={provisional ? "Must-haves not found yet" : "Missing must-haves"}>
                        <span className="font-medium">{missingMust.map(r => r.display).join(", ")}</span>
                    </GuidelineRow>
                )}
                {gaps.length > 0 && (
                    <GuidelineRow tone="warning" label="Add these keywords before applying">
                        <span className="font-medium">{gaps.map(r => r.display).join(", ")}</span>
                    </GuidelineRow>
                )}
                {declinedNeeded.length > 0 && (
                    <GuidelineRow tone="warning" label="You said you don't have">
                        <span className="font-medium">{declinedNeeded.map(r => r.display).join(", ")}</span>
                        <Button size="sm" className="ml-2" onClick={onAnswerDeclined}>I have one now</Button>
                    </GuidelineRow>
                )}
            </CardBody>
        </div>
    );
}

function CapsEditor({ caps, onChange, onSave }: { caps: Preferences["caps"]; onChange: (c: Preferences["caps"]) => void; onSave: () => Promise<void> }) {
    const capsOperation = useJobOperation<"save">();
    const saving = capsOperation.state.status === "running";
    return (
        <div className="space-y-3 rounded-md border border-border bg-surface-muted/50 p-3">
            <p className="text-13 text-fg-muted">Maximum items per section in a recommended selection. Leave empty for no limit.</p>
            <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-3">
                {RESUME_LIST_KEYS.map(key => (
                    <label key={key} className="text-xs text-fg-muted">
                        {SECTION_LABEL[key]}
                        <Input
                            type="number"
                            min={0}
                            value={caps[key] ?? ""}
                            placeholder="∞"
                            onChange={e => onChange({ ...caps, [key]: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })}
                            className="mt-1 h-8 text-13"
                        />
                    </label>
                ))}
            </div>
            <Button size="sm" variant="primary" loading={saving} onClick={async () => { const run = capsOperation.start("save"); if (!run) return; try { await onSave(); } finally { run.complete(); } }}>Save limits</Button>
        </div>
    );
}

export type { Requirement };
