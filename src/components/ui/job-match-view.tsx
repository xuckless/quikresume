// src/components/ui/job-match-view.tsx
"use client";

// Job Match: analyse a job description, score a resume source against it
// (working selection / saved variant / uploaded resume), follow the guidelines,
// inspect the ATS keyword table, and tailor the résumé (tailor-dialog.tsx). The AI proposals
// card is hidden (SHOW_SUGGESTIONS).

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ResumeData } from "@/types/schema";
import type { ResumeVariant } from "@/types/db";
import { JOB_STATUS_LABEL, JOB_STATUSES, type JobRecord, type JobStatus, type MuteRule, type Preferences, type Proposal, type Requirement, type ResumeSource } from "@/lib/match/types";
import type { AliasMap } from "@/lib/tags/normalize";
import { requirementTier, scoreJob, scoreOptionsFor, uncoveredRequirements } from "@/lib/match/score";
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
const MATCH_POLL_MS = 5000;

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

export function JobMatchView(props: JobMatchViewProps) {
    const { jobs, selectedJobId, onSelectJob } = props;
    const router = useRouter();
    const [error, setError] = useState<string | null>(null);
    const [pendingDelete, setPendingDelete] = useState<JobRecord | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [analysing, setAnalysing] = useState(false);
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
                <TrackerView jobs={jobs} onOpen={onSelectJob} onAnalyse={() => setAnalysing(true)} onDelete={setPendingDelete} />
            )}

            <Dialog open={analysing} onClose={() => setAnalysing(false)} title="Analyse a job" description="Paste a job description or upload it. We extract its requirements and score your résumé against them.">
                <AnalyzeForm
                    resumeData={props.resumeData}
                    onAnalyzed={(job) => { setAnalysing(false); onSelectJob(job.id); router.refresh(); }}
                    onError={setError}
                />
            </Dialog>

            <ConfirmDialog
                open={pendingDelete !== null}
                title={`Delete "${pendingDelete?.title}"?`}
                confirmLabel="Delete"
                danger
                busy={deleting}
                onCancel={() => setPendingDelete(null)}
                onConfirm={async () => {
                    if (!pendingDelete) return;
                    setDeleting(true);
                    try {
                        await deleteJob(pendingDelete.id);
                        if (selectedJobId === pendingDelete.id) onSelectJob(null);
                        setPendingDelete(null);
                        router.refresh();
                    } catch (err) {
                        setError(err instanceof Error ? err.message : "Could not delete the job.");
                    } finally {
                        setDeleting(false);
                    }
                }}
            >
                <p>The analysis, its suggestions and the tracker entry are removed. Your library is not affected.</p>
            </ConfirmDialog>
        </div>
    );
}

// ---------- Analyse form

const ACCEPT = ".pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp";

function AnalyzeForm({ resumeData, onAnalyzed, onError }: { resumeData: ResumeData; onAnalyzed: (job: JobRecord) => void; onError: (e: string | null) => void }) {
    const [text, setText] = useState("");
    const [file, setFile] = useState<File | null>(null);
    const [busy, setBusy] = useState<string | null>(null);

    const submit = async () => {
        onError(null);
        try {
            let body: FormData;
            if (text.trim()) {
                body = new FormData();
                body.set("text", text);
            } else if (file) {
                setBusy("Preparing file…");
                body = await documentFormData(file);
            } else return;
            // The working selection rides along so the server can reconcile the requirements
            // against the whole library (semantic matches: degree levels, implied skills, fields).
            body.set("resume", JSON.stringify(resumeData));
            setBusy("Extracting requirements…");
            const res = await fetch("/api/jobs/analyze", { method: "POST", body });
            const json = (await res.json().catch(() => null)) as { ok: boolean; error?: string; job?: JobRecord } | null;
            if (!json) throw new Error(`Analysis failed (${res.status}).`);
            if (!json.ok || !json.job) throw new Error(json.error ?? "Analysis failed.");
            setText("");
            setFile(null);
            onAnalyzed(json.job);
        } catch (err) {
            onError(err instanceof Error ? err.message : "Analysis failed.");
        } finally {
            setBusy(null);
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
                            if (f && f.size > MAX_FILE_BYTES) { onError("That file is over 10 MB."); return; }
                            setFile(f);
                            e.target.value = "";
                        }}
                    />
                    {file ? file.name : "PDF · DOCX · TXT · image"}
                </label>
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
    const [busy, setBusy] = useState<string | null>(null);
    const [uploading, setUploading] = useState<string | null>(null);
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
        onError(null);
        try {
            if (file.size > MAX_FILE_BYTES) throw new Error("That file is over 10 MB.");
            setUploading("Reading resume…");
            const res = await fetch("/api/import", { method: "POST", body: await documentFormData(file) });
            const json = (await res.json().catch(() => null)) as ImportResponse | null;
            if (!json) throw new Error(`Import failed (${res.status}).`);
            if (!json.ok) throw new Error(json.error);
            setUploading("Analysing skills…");
            const tagRes = await fetch("/api/tags/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: allInputs(json.data), context: tagContext(json.data) }) });
            const tagJson = (await tagRes.json().catch(() => null)) as { ok: boolean; error?: string; tagsById?: Record<string, ResumeData["profileTags"]> } | null;
            if (!tagJson?.ok) throw new Error(tagJson?.error ?? "Skill analysis failed.");
            const data = applyTags(json.data, tagJson.tagsById ?? {});
            onExternalResume({ fileName: json.fileName, data });
            setSource({ kind: "upload", fileName: json.fileName });
        } catch (err) {
            onError(err instanceof Error ? err.message : "Could not read that resume.");
        } finally {
            setUploading(null);
        }
    };

    /** Re-runs the broader-context pass against the resume being scored (any source). */
    const recheck = async () => {
        onError(null);
        setBusy("recheck");
        try {
            const res = await fetch("/api/jobs/reconcile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: job.id, resume }) });
            const json = (await res.json().catch(() => null)) as { ok: boolean; error?: string } | null;
            if (!json?.ok) throw new Error(json?.error ?? "The AI match check failed.");
            // The pass itself runs in the background; the refresh picks up "running" and starts the poll.
            router.refresh();
        } catch (err) {
            onError(err instanceof Error ? err.message : "The AI match check failed.");
        } finally {
            setBusy(null);
        }
    };

    const getSuggestions = async () => {
        onError(null);
        setBusy("suggest");
        try {
            const res = await fetch("/api/jobs/proposals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: job.id, resume }) });
            const json = (await res.json().catch(() => null)) as { ok: boolean; error?: string; proposals?: Proposal[] } | null;
            if (!json?.ok || !json.proposals) throw new Error(json?.error ?? "Could not get suggestions.");
            setProposals(json.proposals);
            router.refresh();
        } catch (err) {
            onError(err instanceof Error ? err.message : "Could not get suggestions.");
        } finally {
            setBusy(null);
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
        setBusy(p.id);
        try {
            await onApplyProposal(job, p);
            await setStatus(p, "applied");
        } catch (err) {
            onError(err instanceof Error ? err.message : "Could not apply the suggestion.");
        } finally {
            setBusy(null);
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
    const [tailorRun, setTailorRun] = useState(0);
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
    const roundedScore = Math.round(match.score);
    const scoreToSave = source.kind === "selection" && roundedScore !== job.lastScore ? roundedScore : null;
    useEffect(() => {
        if (scoreToSave === null) return;
        const timer = setTimeout(() => { void saveJobScore(job.id, scoreToSave).catch(() => {}); }, 1500);
        return () => clearTimeout(timer);
    }, [job.id, scoreToSave]);
    const [answering, setAnswering] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);

    // Background reconcile (max effort, up to ~5 min): poll the job's status (one document read) and refresh
    // the page once it stops running. The server turns an expired run into "failed", so the poll always ends.
    const matchRunning = job.match.status === "running";
    useEffect(() => {
        if (!matchRunning) return;
        let stopped = false;
        const timer = setInterval(async () => {
            const reply = await fetch(`/api/jobs/reconcile?jobId=${encodeURIComponent(job.id)}`).then(r => readJson<{ status: string }>(r)).catch(() => null);
            // A failed poll (network, cold start) just waits for the next tick.
            if (stopped || !reply?.ok) return;
            if (reply.status !== "running") {
                stopped = true;
                clearInterval(timer);
                router.refresh();
            }
        }, MATCH_POLL_MS);
        return () => { stopped = true; clearInterval(timer); };
    }, [matchRunning, job.id, router]);

    return (
        <div className="space-y-4">
            {notice && <NoticeBanner tone="success" onDismiss={() => setNotice(null)}>{notice}</NoticeBanner>}
            {matchRunning && (
                <NoticeBanner tone="warning">
                    <span className="inline-flex items-center gap-2">
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                        Checking matches with AI against your whole library. Scores may still go up; this can take a few minutes.
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
                            <Button size="sm" variant="primary" icon={Wand2} onClick={() => setTailorRun(n => n + 1)} title="Pick what goes on your résumé for this job, with AI suggestions">
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
                                <label className={cn("inline-flex h-8 cursor-pointer items-center rounded-md border border-border bg-surface px-2.5 text-13 font-medium hover:bg-surface-hover", uploading && "pointer-events-none opacity-50")}>
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
                                <ScoreHeadline match={match} />
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
                                    <WhatIfList rows={match.rows} />
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
                    onAnswerDeclined={() => setAnswering(true)}
                    showScoreSource={source.kind !== "selection"}
                    fitNotes={job.fitNotes}
                />

                {/* Evidence per requirement, collapsible */}
                <div className="border-t border-border">
                    <CardHeader
                        title="Evidence by requirement"
                        hint="Direct = a skill on the item or confirmed by the AI check · Related = an equivalent skill · Semantic = a line that means it · Keyword only = printed but not shown in your work."
                        action={<Button size="sm" variant="ghost" onClick={() => setShowAts(v => !v)} aria-expanded={showAts}>{showAts ? "Hide" : "Show"}<ChevronDown className={cn("size-3.5 transition-transform", showAts && "rotate-180")} /></Button>}
                    />
                    {showAts && <EvidenceTable rows={match.rows} />}
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
                            <Button size="sm" variant="primary" onClick={getSuggestions} loading={busy === "suggest"} disabled={source.kind === "upload"}>
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
                        busyId={busy && busy !== "suggest" ? busy : null}
                        onApply={apply}
                        onSkip={p => setStatus(p, "skipped")}
                        onIgnoreSimilar={ignoreSimilar}
                        onReopen={p => setStatus(p, "open")}
                        muted={muted}
                        onUnmute={unmute}
                    />
                </CardBody>
            </Card>}

            {tailorRun > 0 && (
                <TailorDialog
                    key={tailorRun}
                    job={job}
                    resumeData={resumeData}
                    declined={preferences.declinedSoftSkills}
                    aliases={aliases}
                    caps={caps}
                    onClose={(message) => { setTailorRun(0); if (message) setNotice(message); }}
                />
            )}

            {answering && (
                <Dialog open onClose={() => setAnswering(false)} size="lg" title="Skills you said you don't have" description="Changed your mind? Add them and the warning goes away.">
                    <SkillQuestions
                        gaps={declinedNeeded}
                        declined={preferences.declinedSoftSkills}
                        library={resumeData}
                        onSkip={() => setAnswering(false)}
                        skipLabel="Close"
                        onSaved={(r) => { setAnswering(false); setNotice(r.warning ? `Saved. ${r.warning}` : "Saved to your library."); router.refresh(); }}
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
    const save = async (fn: () => Promise<void>) => {
        try { await fn(); router.refresh(); } catch (err) { onError(err instanceof Error ? err.message : "Could not save."); }
    };
    return (
        <div className="grid gap-3 border-b border-border px-4 py-3 @2xl:grid-cols-[10rem_10rem_minmax(0,1fr)]">
            <Field label="Status" htmlFor={`status-${job.id}`}>
                <Select id={`status-${job.id}`} value={job.status} onChange={e => void save(() => setJobStatus(job.id, e.target.value as JobStatus))}>
                    {JOB_STATUSES.map(st => <option key={st} value={st}>{JOB_STATUS_LABEL[st]}</option>)}
                </Select>
            </Field>
            <Field label="Applied" htmlFor={`applied-${job.id}`}>
                <Input id={`applied-${job.id}`} type="date" defaultValue={job.appliedAt ?? ""} onBlur={e => {
                    const v = e.target.value || null;
                    if (v !== job.appliedAt) void save(() => updateJobMeta(job.id, { appliedAt: v }));
                }} />
            </Field>
            <Field label="Notes" htmlFor={`notes-${job.id}`} hint={job.url ? undefined : "Private to you."}>
                <div className="flex items-center gap-2">
                    <Input id={`notes-${job.id}`} value={notes} placeholder="Recruiter name, referral, next step…" onChange={e => setNotes(e.target.value)} onBlur={() => {
                        if (notes !== job.notes) void save(() => updateJobMeta(job.id, { notes }));
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

function GuidelinesSection({ missingMust, keywordGaps, declinedNeeded, onAnswerDeclined, showScoreSource, fitNotes }: {
    missingMust: Requirement[];
    keywordGaps: Requirement[];
    declinedNeeded: Requirement[];
    onAnswerDeclined: () => void;
    showScoreSource: boolean;
    fitNotes: string[];
}) {
    const declined = new Set(declinedNeeded.map(r => r.name));
    const gaps = keywordGaps.filter(r => !declined.has(r.name));
    const empty = missingMust.length === 0 && gaps.length === 0 && declinedNeeded.length === 0 && fitNotes.length === 0;
    return (
        <div className="border-t border-border">
            <CardHeader title="Guidelines" hint={showScoreSource ? "For the résumé being scored above." : "For your working selection."} />
            <CardBody className="space-y-3 text-13">
                {empty && <p className="text-fg-muted">Nothing missing. Every requirement is covered by the résumé above.</p>}
                {fitNotes.length > 0 && (
                    <GuidelineRow tone="warning" label="Fit with your goals">
                        <ul className="space-y-1">{fitNotes.map(n => <li key={n}>{n}</li>)}</ul>
                    </GuidelineRow>
                )}
                {missingMust.length > 0 && (
                    <GuidelineRow tone="danger" label="Missing must-haves">
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
    const [saving, setSaving] = useState(false);
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
            <Button size="sm" variant="primary" loading={saving} onClick={async () => { setSaving(true); try { await onSave(); } finally { setSaving(false); } }}>Save limits</Button>
        </div>
    );
}

export type { Requirement };
