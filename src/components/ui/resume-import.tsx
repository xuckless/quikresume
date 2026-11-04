// src/components/ui/resume-import.tsx
// Resume import flow: pick one or more files -> (PDF: render pages in the
// browser) -> POST /api/import per file -> combined review -> hand the
// selection to the dashboard, which merges it into the editor draft.
// Nothing is persisted here.
"use client";

import React, { useState } from "react";
import type { PersonalInfo, ResumeData, ResumeListKey } from "@/types/schema";
import { emptyResumeData, RESUME_LIST_KEYS } from "@/types/schema";
import { classifyIncoming, combineParsedFiles, type CombinedImport, type ImportSelection, type ParsedFile } from "@/lib/import/merge";
import { MAX_FILE_BYTES, MAX_PDF_PAGES, type ImportResponse } from "@/lib/import/types";
import { documentFormData } from "@/lib/import/pdf-pages";
import { itemLabel, itemTitle, SECTION_LABEL } from "@/lib/sections";
import { validateItemDates } from "@/lib/validation/dates";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/primitives/button";
import { Checkbox } from "@/components/ui/primitives/field";
import { Card, CardBody, CardHeader, SectionHeader } from "@/components/ui/primitives/card";
import { Badge } from "@/components/ui/primitives/badge";
import { NoticeBanner } from "@/components/ui/primitives/notice-banner";
import { Loader2, Upload } from "@/components/ui/primitives/icons";

interface ResumeImportProps {
    /** What the library (or the open draft) currently holds; drives the New / Merges / Already labels. */
    current: ResumeData;
    onImport: (selection: ImportSelection, meta: { fileNames: string[] }) => void;
    onCancel: () => void;
}

type FileStatus = "queued" | "rendering" | "reading" | "done" | "failed";
interface QueuedFile { file: File; status: FileStatus; error?: string }

type Stage =
    | { step: "pick"; error: string | null }
    | { step: "working" }
    | { step: "review"; result: CombinedImport };

const ACCEPT = ".pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp";
const MAX_FILES = 6;

export function ResumeImport({ current, onImport, onCancel }: ResumeImportProps) {
    const [stage, setStage] = useState<Stage>({ step: "pick", error: null });
    const [queue, setQueue] = useState<QueuedFile[]>([]);
    const [dragOver, setDragOver] = useState(false);

    const addFiles = (list: FileList | File[] | null | undefined) => {
        if (!list) return;
        const incoming = Array.from(list);
        const errors: string[] = [];
        setQueue(prev => {
            const next = [...prev];
            for (const f of incoming) {
                if (next.some(q => q.file.name === f.name && q.file.size === f.size)) continue;
                if (f.size > MAX_FILE_BYTES) { errors.push(`${f.name} is over 10 MB and was skipped.`); continue; }
                if (next.length >= MAX_FILES) { errors.push(`Only ${MAX_FILES} files per import; ${f.name} was skipped.`); continue; }
                next.push({ file: f, status: "queued" });
            }
            return next;
        });
        setStage({ step: "pick", error: errors.length ? errors.join(" ") : null });
    };

    const removeFile = (name: string) => setQueue(prev => prev.filter(q => q.file.name !== name));

    const setStatus = (name: string, status: FileStatus, error?: string) =>
        setQueue(prev => prev.map(q => (q.file.name === name ? { ...q, status, error } : q)));

    const analyze = async () => {
        if (queue.length === 0) return;
        setStage({ step: "working" });
        const parsed: ParsedFile[] = [];
        for (const q of queue) {
            try {
                setStatus(q.file.name, "rendering");
                const body = await documentFormData(q.file);
                setStatus(q.file.name, "reading");
                const res = await fetch("/api/import", { method: "POST", body });
                const json = (await res.json().catch(() => null)) as ImportResponse | null;
                if (!json) throw new Error(`Import failed (${res.status}).`);
                if (!json.ok) throw new Error(json.error);
                parsed.push({ fileName: json.fileName, data: json.data, warnings: json.warnings });
                setStatus(q.file.name, "done");
            } catch (err) {
                setStatus(q.file.name, "failed", err instanceof Error ? err.message : "Import failed.");
            }
        }
        if (parsed.length === 0) {
            setStage({ step: "pick", error: "None of the files could be read. See the errors next to each file." });
            return;
        }
        setStage({ step: "review", result: combineParsedFiles(parsed, emptyResumeData()) });
    };

    if (stage.step === "review") {
        return (
            <ReviewStep
                key={stage.result.fileNames.join("|")}
                result={stage.result}
                current={current}
                onConfirm={(sel) => onImport(sel, { fileNames: stage.result.fileNames })}
                onRestart={() => { setQueue([]); setStage({ step: "pick", error: null }); }}
            />
        );
    }

    const working = stage.step === "working";

    return (
        <Card>
            <CardHeader
                title="Import existing résumés"
                hint="Upload PDFs, Word documents, text files or photos. GLM-4.6V reads each one and sorts everything into your library sections. Duplicates across files are merged, and you review before anything is saved."
            />
            <CardBody className="space-y-4">
                {stage.step === "pick" && stage.error && <NoticeBanner tone="danger">{stage.error}</NoticeBanner>}

                <label
                    onDragOver={(e) => { e.preventDefault(); if (!working) setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => { e.preventDefault(); setDragOver(false); if (!working) addFiles(e.dataTransfer.files); }}
                    className={cn(
                        "block cursor-pointer rounded-lg border border-dashed p-8 text-center transition-colors md:p-12",
                        dragOver ? "border-fg bg-surface-muted" : "border-border-strong bg-surface-muted/50 hover:border-fg-subtle",
                        working && "pointer-events-none opacity-60",
                    )}
                >
                    <input type="file" multiple accept={ACCEPT} className="sr-only" disabled={working} onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
                    <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-md bg-surface border border-border">
                        <Upload className="size-5 text-fg-muted" />
                    </div>
                    <p className="text-sm font-medium text-fg">{queue.length ? "Add another file" : "Drop your résumés here, or click to browse"}</p>
                    <p className="mt-1 text-13 text-fg-subtle">PDF · DOCX · TXT · PNG / JPG · up to 10 MB and {MAX_PDF_PAGES} pages each · {MAX_FILES} files max</p>
                </label>

                {queue.length > 0 && (
                    <ul className="divide-y divide-border rounded-lg border border-border" aria-live="polite">
                        {queue.map(q => (
                            <li key={q.file.name} className="flex items-center gap-3 px-3 py-2.5">
                                <StatusDot status={q.status} />
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium text-fg">{q.file.name}</p>
                                    <p className={cn("text-xs", q.status === "failed" ? "text-danger" : "text-fg-subtle")}>
                                        {q.status === "queued" && `${(q.file.size / 1024).toFixed(0)} KB · waiting`}
                                        {q.status === "rendering" && "Rendering pages…"}
                                        {q.status === "reading" && "Reading with GLM-4.6V… up to a minute"}
                                        {q.status === "done" && "Done"}
                                        {q.status === "failed" && (q.error ?? "Failed")}
                                    </p>
                                </div>
                                {!working && <Button size="sm" variant="ghost" onClick={() => removeFile(q.file.name)}>Remove</Button>}
                            </li>
                        ))}
                    </ul>
                )}

                <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
                    <Button variant="ghost" onClick={onCancel} disabled={working}>Cancel</Button>
                    <Button variant="primary" onClick={analyze} disabled={queue.length === 0} loading={working}>
                        {working ? "Analysing" : queue.length > 1 ? `Analyse ${queue.length} files` : "Analyse résumé"}
                    </Button>
                </div>
            </CardBody>
        </Card>
    );
}

function StatusDot({ status }: { status: FileStatus }) {
    if (status === "rendering" || status === "reading") return <Loader2 className="size-4 shrink-0 animate-spin text-fg-muted" aria-hidden />;
    const cls = status === "done" ? "bg-success" : status === "failed" ? "bg-danger" : "bg-border-strong";
    return <span className={cn("size-2 shrink-0 rounded-full", cls)} />;
}

// ---------- Review ----------

interface ReviewStepProps {
    result: CombinedImport;
    current: ResumeData;
    onConfirm: (sel: ImportSelection) => void;
    onRestart: () => void;
}

const PERSONAL_LABEL: Record<keyof PersonalInfo, string> = {
    firstName: "First name", lastName: "Last name", headline: "Headline", email: "Email", phone: "Phone",
    location: "Location", github: "GitHub", linkedin: "LinkedIn", website: "Website", summary: "Summary",
};

function ReviewStep({ result, current, onConfirm, onRestart }: ReviewStepProps) {
    const { data, warnings, fileNames, sourceById } = result;
    const multi = fileNames.length > 1;

    // Classify once per item against the library / open draft.
    const classes: Record<string, ReturnType<typeof classifyIncoming>> = {};
    for (const key of RESUME_LIST_KEYS) {
        for (const item of data[key] as ResumeData[typeof key][number][]) classes[item.id] = classifyIncoming(current, key, item);
    }

    const [checked, setChecked] = useState<Record<string, boolean>>(() => {
        const init: Record<string, boolean> = {};
        for (const key of RESUME_LIST_KEYS) for (const item of data[key]) init[item.id] = classes[item.id]?.kind !== "same";
        return init;
    });
    const parsedPersonal = (Object.keys(PERSONAL_LABEL) as (keyof PersonalInfo)[]).filter(f => data.personalInfo[f].trim());
    const [applyPersonal, setApplyPersonal] = useState(parsedPersonal.length > 0);
    const [replacePersonal, setReplacePersonal] = useState(false);

    const total = RESUME_LIST_KEYS.reduce((n, key) => n + data[key].length, 0);
    const selectedCount = Object.values(checked).filter(Boolean).length;
    const counts = { new: 0, merge: 0, same: 0 };
    for (const c of Object.values(classes)) counts[c.kind]++;
    const toggleSection = (key: ResumeListKey, value: boolean) =>
        setChecked(prev => {
            const next = { ...prev };
            for (const item of data[key]) next[item.id] = value;
            return next;
        });

    const confirm = () => {
        const items: ImportSelection["items"] = {};
        for (const key of RESUME_LIST_KEYS) {
            const picked = (data[key] as ResumeData[typeof key][number][]).filter(it => checked[it.id]);
            if (picked.length) (items[key] as unknown[]) = picked;
        }
        onConfirm({ personalInfo: applyPersonal ? data.personalInfo : null, replacePersonal, links: applyPersonal ? data.links : [], items });
    };

    const warningCount = warnings.reduce((n, w) => n + w.warnings.length, 0);

    return (
        <Card>
            <CardHeader
                title="Review what we found"
                hint={<>
                    From <span className="font-medium text-fg">{fileNames.join(", ")}</span>: {total} {total === 1 ? "item" : "items"}
                    {parsedPersonal.length > 0 ? " plus personal details" : ""}.
                    {counts.new > 0 && ` ${counts.new} new.`}
                    {counts.merge > 0 && ` ${counts.merge} will add detail to items you already have.`}
                    {counts.same > 0 && ` ${counts.same} already in your library (unticked).`}
                    {" "}You can edit every field afterwards in the editor.
                </>}
            />
            <CardBody className="space-y-6">
                {total === 0 && parsedPersonal.length === 0 && (
                    <NoticeBanner tone="warning">Nothing usable was found. Try a clearer scan or a text-based PDF.</NoticeBanner>
                )}

                {warningCount > 0 && (
                    <details className="rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-13 text-warning">
                        <summary className="cursor-pointer font-medium">{warningCount} {warningCount === 1 ? "entry was" : "entries were"} skipped</summary>
                        {warnings.map(w => (
                            <div key={w.fileName} className="mt-2">
                                {multi && <p className="text-xs font-medium">{w.fileName}</p>}
                                <ul className="ml-5 mt-1 list-disc space-y-0.5">{w.warnings.map((x, i) => <li key={i}>{x}</li>)}</ul>
                            </div>
                        ))}
                    </details>
                )}

                {parsedPersonal.length > 0 && (
                    <section className="space-y-3">
                        <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-border px-4 py-3">
                            <div>
                                <span className="block text-sm font-medium text-fg">Personal details</span>
                                <span className="block text-13 text-fg-muted">
                                    {replacePersonal ? "Overwrites your current details" : "Fills in only the fields you left empty"}
                                </span>
                            </div>
                            <Checkbox checked={applyPersonal} onChange={(e) => setApplyPersonal(e.target.checked)} />
                        </label>
                        {applyPersonal && (
                            <>
                                <dl className="grid gap-x-8 gap-y-1.5 px-1 md:grid-cols-2">
                                    {parsedPersonal.map(f => {
                                        const existing = current.personalInfo[f].trim();
                                        const willApply = replacePersonal || !existing;
                                        return (
                                            <div key={f} className={cn("flex gap-3 py-0.5 text-13", !willApply && "opacity-50")}>
                                                <dt className="w-24 shrink-0 text-fg-subtle">{PERSONAL_LABEL[f]}</dt>
                                                <dd className="min-w-0 break-words text-fg">{data.personalInfo[f]}{!willApply && <span className="text-fg-subtle"> (kept: {existing})</span>}</dd>
                                            </div>
                                        );
                                    })}
                                </dl>
                                <label className="flex cursor-pointer items-center gap-2 px-1 text-13 text-fg-muted">
                                    <Checkbox checked={replacePersonal} onChange={(e) => setReplacePersonal(e.target.checked)} />
                                    Replace my existing details with these
                                </label>
                            </>
                        )}
                    </section>
                )}

                {RESUME_LIST_KEYS.filter(key => data[key].length > 0).map(key => {
                    const items = data[key] as ResumeData[typeof key][number][];
                    const picked = items.filter(it => checked[it.id]).length;
                    return (
                        <section key={key} className="space-y-2">
                            <SectionHeader
                                title={SECTION_LABEL[key]}
                                count={items.length}
                                action={<Button size="sm" variant="ghost" onClick={() => toggleSection(key, picked !== items.length)}>{picked === items.length ? "Untick all" : "Tick all"}</Button>}
                            />
                            <ul className="divide-y divide-border rounded-lg border border-border">
                                {items.map(item => {
                                    const { title, subtitle, meta } = itemLabel(key, item);
                                    const cls = classes[item.id];
                                    const dateErrors = validateItemDates(key, item);
                                    const dateError = dateErrors.start ?? dateErrors.end ?? dateErrors.date;
                                    return (
                                        <li key={item.id}>
                                            <label className={cn("flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors", !checked[item.id] && "opacity-60")}>
                                                <Checkbox checked={Boolean(checked[item.id])} onChange={(e) => setChecked(prev => ({ ...prev, [item.id]: e.target.checked }))} className="mt-0.5" />
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <p className="break-words text-sm font-medium text-fg">{title || <span className="text-fg-subtle">Untitled</span>}</p>
                                                        <ClassChip cls={cls} sectionKey={key} />
                                                        {dateError && <Badge tone="danger" title={`${dateError} You can fix it in the editor.`}>Check dates</Badge>}
                                                    </div>
                                                    {subtitle && <p className="break-words text-13 text-fg-muted">{subtitle}</p>}
                                                    {(meta || multi) && <p className="mt-0.5 text-xs text-fg-subtle">{[meta, multi ? sourceById[item.id] : ""].filter(Boolean).join(" · ")}</p>}
                                                </div>
                                            </label>
                                        </li>
                                    );
                                })}
                            </ul>
                        </section>
                    );
                })}

                <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
                    <Button variant="ghost" onClick={onRestart}>Start over</Button>
                    <Button variant="primary" onClick={confirm} disabled={selectedCount === 0 && !applyPersonal}>
                        Add {selectedCount} {selectedCount === 1 ? "item" : "items"} to the editor
                    </Button>
                </div>
            </CardBody>
        </Card>
    );
}

function ClassChip({ cls, sectionKey }: { cls: ReturnType<typeof classifyIncoming> | undefined; sectionKey: ResumeListKey }) {
    if (!cls || cls.kind === "new") return <Badge tone="success">New</Badge>;
    if (cls.kind === "merge") {
        const into = cls.existing ? itemTitle(sectionKey, cls.existing) : "";
        return <Badge title={into ? `Merges into ${into}` : undefined}>Adds detail</Badge>;
    }
    return <Badge className="text-fg-subtle">Already in library</Badge>;
}
