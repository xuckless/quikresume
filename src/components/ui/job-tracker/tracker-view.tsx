// src/components/ui/job-tracker/tracker-view.tsx
"use client";

// Job Tracker: every saved / analysed job as a board (saved -> applied -> interview -> offer ->
// rejected) or a table. Opening a job shows its Job Match page. Status changes are optimistic and
// saved through setJobStatus; dragging a card between columns and the status menu do the same thing,
// so keyboard users never need the drag.

import { CompanyLogo } from "./company-logo";
import { ScoreRing } from "@/components/ui/primitives/score-ring";
import React, { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
    DndContext, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { setJobStatus } from "@/app/actions/job-actions";
import { JOB_STATUS_LABEL, JOB_STATUSES, type JobRecord, type JobStatus } from "@/lib/match/types";
import { cn } from "@/lib/cn";
import { createPersistedStore } from "@/lib/ui/persisted-store";
import { Button, FOCUS_RING, IconButton } from "@/components/ui/primitives/button";
import { Input, Select } from "@/components/ui/primitives/field";
import { Segmented } from "@/components/ui/primitives/segmented";
import { EmptyState } from "@/components/ui/primitives/empty-state";
import { NoticeBanner } from "@/components/ui/primitives/notice-banner";
import { Table, Td, Th } from "@/components/ui/primitives/table";
import { Briefcase, ExternalLink, Loader2, MapPin, Plus, Search, Trash2 } from "@/components/ui/primitives/icons";

type Layout = "board" | "table";
const layoutStore = createPersistedStore<Layout>({
    key: "quikresume.trackerLayout",
    storage: "local",
    initial: "board",
    serialize: v => v,
    deserialize: s => (s === "table" ? "table" : "board"),
});

export function TrackerView({ jobs, onOpen, onAnalyse, onDelete }: {
    jobs: JobRecord[];
    onOpen: (id: string) => void;
    onAnalyse: () => void;
    onDelete: (job: JobRecord) => void;
}) {
    const router = useRouter();
    const layout = layoutStore.useValue();
    const [query, setQuery] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [, startTransition] = useTransition();
    const [optimistic, applyOptimistic] = useOptimistic(jobs, (list: JobRecord[], u: { id: string; status: JobStatus }) =>
        list.map(j => (j.id === u.id ? { ...j, status: u.status } : j)),
    );

    const move = (id: string, status: JobStatus) => {
        const job = optimistic.find(j => j.id === id);
        if (!job || job.status === status) return;
        startTransition(async () => {
            applyOptimistic({ id, status });
            try {
                await setJobStatus(id, status);
                router.refresh();
            } catch (err) {
                setError(err instanceof Error ? err.message : "Could not update the status.");
            }
        });
    };

    const q = query.trim().toLowerCase();
    const visible = q
        ? optimistic.filter(j => `${j.title} ${j.company} ${j.location} ${j.notes}`.toLowerCase().includes(q))
        : optimistic;

    if (jobs.length === 0) {
        return (
            <EmptyState
                icon={Briefcase}
                title="No jobs yet"
                body="Analyse a job description, or save postings in one click with the browser extension. Each job gets a match score and moves across your board as you apply."
                actions={<Button variant="primary" icon={Plus} onClick={onAnalyse}>Analyse a job</Button>}
            />
        );
    }

    return (
        <div className="space-y-4">
            {error && <NoticeBanner tone="danger" onDismiss={() => setError(null)}>{error}</NoticeBanner>}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative w-full sm:max-w-xs">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle" aria-hidden />
                    <Input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search jobs…" aria-label="Search jobs" className="h-8 pl-8 text-13" />
                </div>
                <div className="flex items-center gap-2">
                    <Segmented value={layout} onChange={layoutStore.set} options={[{ value: "board", label: "Board" }, { value: "table", label: "Table" }]} />
                    <Button size="sm" variant="primary" icon={Plus} onClick={onAnalyse}>Analyse a job</Button>
                </div>
            </div>
            {layout === "board"
                ? <Board jobs={visible} onMove={move} onOpen={onOpen} />
                : <JobTable jobs={visible} onMove={move} onOpen={onOpen} onDelete={onDelete} />}
        </div>
    );
}

// ---------- shared bits

function StatusSelect({ job, onMove, className }: { job: JobRecord; onMove: (id: string, s: JobStatus) => void; className?: string }) {
    return (
        <Select
            value={job.status}
            onChange={e => onMove(job.id, e.target.value as JobStatus)}
            aria-label={`Status of ${job.title}`}
            className={className}
            selectClassName="h-7 text-xs"
            onClick={e => e.stopPropagation()}
        >
            {JOB_STATUSES.map(s => <option key={s} value={s}>{JOB_STATUS_LABEL[s]}</option>)}
        </Select>
    );
}

function Score({ job, size = 36 }: { job: JobRecord; size?: number }) {
    const box = "flex shrink-0 items-center justify-center";
    if (job.match.status === "running") return <span className={box} style={{ width: size, height: size }}><Loader2 className="size-3.5 animate-spin text-fg-subtle" aria-label="Checking matches with AI" /></span>;
    if (job.lastScore === null) return <span className={cn(box, "text-xs text-fg-subtle")} style={{ width: size, height: size }} title="Open the job to score it">–</span>;
    return <span title="Match score of your working selection" className="shrink-0"><ScoreRing score={job.lastScore} size={size} /></span>;
}

// ---------- board

function Board({ jobs, onMove, onOpen }: { jobs: JobRecord[]; onMove: (id: string, s: JobStatus) => void; onOpen: (id: string) => void }) {
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
    const end = ({ active, over }: DragEndEvent) => {
        if (over && typeof over.id === "string") onMove(String(active.id), over.id as JobStatus);
    };
    return (
        <DndContext id="job-tracker-board" sensors={sensors} onDragEnd={end}>
            <div className="grid auto-cols-[minmax(220px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2">
                {JOB_STATUSES.map(status => (
                    <Column key={status} status={status} jobs={jobs.filter(j => j.status === status)} onMove={onMove} onOpen={onOpen} />
                ))}
            </div>
        </DndContext>
    );
}

function Column({ status, jobs, onMove, onOpen }: { status: JobStatus; jobs: JobRecord[]; onMove: (id: string, s: JobStatus) => void; onOpen: (id: string) => void }) {
    const { setNodeRef, isOver } = useDroppable({ id: status });
    return (
        <section
            ref={setNodeRef}
            aria-label={JOB_STATUS_LABEL[status]}
            className={cn("flex min-h-40 flex-col rounded-lg border border-border bg-surface-muted p-2 transition-colors", isOver && "border-border-strong bg-surface-hover")}
        >
            <header className="flex items-center justify-between px-1 pb-2">
                <h3 className="text-13 font-medium text-fg">{JOB_STATUS_LABEL[status]}</h3>
                <span className="font-mono text-xs tabular-nums text-fg-subtle">{jobs.length}</span>
            </header>
            <ul className="space-y-2">
                {jobs.map(j => <JobCard key={j.id} job={j} onMove={onMove} onOpen={onOpen} />)}
            </ul>
        </section>
    );
}

function JobCard({ job, onMove, onOpen }: { job: JobRecord; onMove: (id: string, s: JobStatus) => void; onOpen: (id: string) => void }) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: job.id });
    return (
        <li
            ref={setNodeRef}
            style={{ transform: CSS.Translate.toString(transform) }}
            className={cn("rounded-md border border-border bg-surface shadow-sm", isDragging && "relative z-10 opacity-90")}
        >
            <div {...listeners} {...attributes} aria-roledescription="Draggable job" className={cn("cursor-grab rounded-md p-2.5 active:cursor-grabbing", FOCUS_RING)}>
                <div className="flex items-start gap-2.5">
                    <CompanyLogo job={job} size={32} className="mt-0.5" />
                    <button
                        type="button"
                        onClick={() => onOpen(job.id)}
                        className={cn("min-w-0 flex-1 text-left", FOCUS_RING)}
                        // The card itself is the drag handle; the title is the link.
                        onPointerDown={e => e.stopPropagation()}
                    >
                        <span className="block truncate text-13 font-medium text-fg hover:underline">{job.title}</span>
                        <span className="block truncate text-xs text-fg-muted">{job.company || "Unknown company"}</span>
                    </button>
                    <Score job={job} />
                </div>
                {job.location && (
                    <p className="mt-1.5 flex items-center gap-1 truncate text-xs text-fg-subtle"><MapPin className="size-3 shrink-0" aria-hidden />{job.location}</p>
                )}
                <div className="mt-2" onPointerDown={e => e.stopPropagation()}>
                    <StatusSelect job={job} onMove={onMove} />
                </div>
            </div>
        </li>
    );
}

// ---------- table

function JobTable({ jobs, onMove, onOpen, onDelete }: { jobs: JobRecord[]; onMove: (id: string, s: JobStatus) => void; onOpen: (id: string) => void; onDelete: (j: JobRecord) => void }) {
    return (
        <div className="rounded-lg border border-border bg-surface">
            <Table>
                <thead>
                    <tr><Th>Job</Th><Th>Status</Th><Th className="text-right">Score</Th><Th>Applied</Th><Th>Updated</Th><Th><span className="sr-only">Actions</span></Th></tr>
                </thead>
                <tbody>
                    {jobs.map(j => (
                        <tr key={j.id} className="group/row hover:bg-surface-hover">
                            <Td>
                                <div className="flex items-center gap-3">
                                    <CompanyLogo job={j} size={28} />
                                    <button type="button" onClick={() => onOpen(j.id)} className={cn("min-w-0 text-left", FOCUS_RING)}>
                                        <span className="block font-medium text-fg hover:underline">{j.title}</span>
                                        <span className="block text-xs text-fg-muted">{[j.company || "Unknown company", j.location].filter(Boolean).join(" · ")}</span>
                                    </button>
                                </div>
                            </Td>
                            <Td className="w-36"><StatusSelect job={j} onMove={onMove} /></Td>
                            <Td><div className="flex justify-end"><Score job={j} size={30} /></div></Td>
                            <Td className="whitespace-nowrap text-fg-muted">{j.appliedAt ?? "–"}</Td>
                            <Td className="whitespace-nowrap text-fg-muted">{j.updatedAt ? j.updatedAt.slice(0, 10) : "–"}</Td>
                            <Td className="w-20 text-right">
                                <span className="inline-flex items-center">
                                    {j.url && (
                                        <a href={j.url} target="_blank" rel="noreferrer noopener" aria-label={`Open the posting for ${j.title}`} className={cn("inline-flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-surface-muted hover:text-fg", FOCUS_RING)}>
                                            <ExternalLink className="size-3.5" aria-hidden />
                                        </a>
                                    )}
                                    <IconButton icon={Trash2} aria-label={`Delete ${j.title}`} onClick={() => onDelete(j)} className="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100" />
                                </span>
                            </Td>
                        </tr>
                    ))}
                </tbody>
            </Table>
        </div>
    );
}
