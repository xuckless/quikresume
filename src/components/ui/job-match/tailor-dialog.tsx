"use client";

// Tailor window: questions about uncovered requirements -> the working selection,
// editable (items, bullets, skills) with live score and page count. The AI plan
// runs in the background and only ever shows up as highlighted suggestions
// (accept / dismiss / accept all); trimming to one page is a suggestion too, or
// applied with "Fit to one page". Switching off what covers a hard requirement is
// allowed and explained in yellow. Close writes the selection onto the working
// selection; Save variant (and download PDF) creates and loads a variant.

import React, { useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ResumeData, ResumeListKey } from "@/types/schema";
import type { Caps, DeclinedSkill, JobRecord, Requirement } from "@/lib/match/types";
import type { AliasMap } from "@/lib/tags/normalize";
import { scoreJob, scoreOptionsFor, uncoveredRequirements, type ScoreOptions } from "@/lib/match/score";
import {
    acceptSuggestion, applySelection, buildTailorPlan, diffSuggestions, fitToOnePage, isPending, planSelection, selectionOf, setHidden, setInclude,
    subEntriesOf, TRIM_ITEM_REASON, TRIM_KEY_REASON, overrideWarnings, type TailorPlan, type TailorSelection, type TailorSuggestion,
} from "@/lib/match/auto-tailor";
import { TAILOR_QUESTIONS, tailorFlowTransition, type TailorAi } from "@/lib/match/tailor-flow";
import { selectedHidden, selectedIds, selectionEquals } from "@/lib/variants";
import { pdfFileName, toTypstDoc } from "@/lib/typst/doc";
import { compilePdf, compileSvg, ensureTypst, formatTypstError } from "@/lib/typst/client";
import { itemTitle, SECTION_LABEL } from "@/lib/sections";
import { moveItem, moveSection, orderedItems } from "@/lib/layout/order";
import type { SectionId } from "@/lib/layout/types";
import { SortableList, useSortableRow } from "@/components/ui/primitives/sortable";
import { applyWorkingSelection, createVariantFromPlan } from "@/app/actions/variant-actions";
import { cn } from "@/lib/cn";
import { Dialog } from "@/components/ui/primitives/dialog";
import { Button, FOCUS_RING } from "@/components/ui/primitives/button";
import { Checkbox, Input } from "@/components/ui/primitives/field";
import { Reveal } from "@/components/ui/primitives/reveal";
import { Switch } from "@/components/ui/primitives/switch";
import { Badge } from "@/components/ui/primitives/badge";
import { NoticeBanner } from "@/components/ui/primitives/notice-banner";
import { ScoreRing } from "@/components/ui/primitives/score-ring";
import { ChevronDown, Download, Eye, Loader2, Lock, Sparkles } from "@/components/ui/primitives/icons";
import { SubItemList } from "@/components/ui/sub-item-toggles";
import { ResumePreview } from "@/components/ui/resume-preview";
import { useResumePageCount } from "@/components/ui/use-page-count";
import { useOperation } from "@/lib/ui/use-operation";
import { SkillQuestions } from "./skill-questions";

/** Footer actions; one at a time. */
type Action = "close" | "save" | "download" | "fit";
type TrimNotes = { items: Record<string, string>; keys: Record<string, Record<string, string>> };

interface TailorDialogProps {
    job: JobRecord;
    /** Library with the working selection (server truth). */
    resumeData: ResumeData;
    declined: DeclinedSkill[];
    aliases: AliasMap;
    caps: Caps;
    /** Closed; `message` describes what was saved, if anything. */
    onClose: (message?: string) => void;
}

const pagesOf = (lib: ResumeData) => async (sel: TailorSelection) => (await compileSvg(toTypstDoc(applySelection(lib, sel)))).pageCount;

/** Mount fresh per opening so every run starts clean. */
export function TailorDialog({ job, resumeData, declined: initialDeclined, aliases, caps, onClose }: TailorDialogProps) {
    const router = useRouter();
    const [declined, setDeclined] = useState(initialDeclined);
    // Step 1's questions are a snapshot of this opening: the job page refreshes `job` when the background AI
    // check lands, and a recomputed list would lose or shift rows mid-answer. The review (startReview) reads
    // `job.requirements` when it opens, so it does start from the freshest verdicts.
    const [gaps] = useState(() => uncoveredRequirements(job.requirements, resumeData, aliases));
    const hasQuestions = gaps.length > 0;

    // Nothing to ask: the review (run 1) is open from the first render and the effect below starts its AI.
    const [flow, dispatch] = useReducer(tailorFlowTransition, null, () => hasQuestions ? TAILOR_QUESTIONS : tailorFlowTransition(TAILOR_QUESTIONS, {
        type: "review", run: 1, library: resumeData, plan: buildTailorPlan(job.requirements, resumeData, caps, aliases), requirements: job.requirements, warning: null,
    }));
    const review = flow.step === "review" ? flow : null;
    const library = review?.library ?? resumeData;
    const requirements = review?.requirements ?? job.requirements;
    const ai: TailorAi = review?.ai ?? { status: "running" };
    const [sel, setSel] = useState<TailorSelection>(() => selectionOf(resumeData));
    const [dismissed, setDismissed] = useState<Set<string>>(new Set());
    const [trimNotes, setTrimNotes] = useState<TrimNotes>({ items: {}, keys: {} });
    const [allowMultiPage, setAllowMultiPage] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const [name, setName] = useState([job.company, job.title].filter(Boolean).join(" · ") || "Tailored résumé");
    // Only Save returns something: the PDF bytes (download) and how many items were skipped.
    const action = useOperation<Action, { bytes: Uint8Array | null; missing: number } | void>();
    const lastRun = useRef(flow.run);
    const started = useRef(false);
    // Skips the page fitting (a burst of Typst compiles) once the dialog is gone; the reducer drops late results anyway.
    const mounted = useRef(true);

    /** Background AI pass for review `run`: plan from the model, then fitted suggestions. */
    const runAi = async (run: number, lib: ResumeData, tagPlan: TailorPlan) => {
        const base = selectionOf(lib);
        let reviewed = tagPlan;
        let failure: string | null = null;
        try {
            const res = await fetch("/api/jobs/auto-tailor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: job.id, resume: lib }) });
            const json = (await res.json().catch(() => null)) as
                | { ok: true; plan: TailorPlan; requirements: Requirement[]; warning?: string }
                | { ok: false; error: string }
                | null;
            if (!json) throw new Error(`The AI review failed (${res.status}).`);
            if (!json.ok) throw new Error(json.error);
            reviewed = json.plan;
            dispatch({ type: "reviewed", run, plan: json.plan, requirements: json.requirements, warning: json.warning ?? null });
        } catch (err) {
            failure = `${err instanceof Error ? err.message : "The AI review failed."} Suggestions come from tag matching only.`;
        }

        if (!mounted.current || run !== lastRun.current) return;
        try {
            await ensureTypst();
            const target = { ...planSelection(reviewed), layout: base.layout };
            const fitted = await fitToOnePage(reviewed, target, lib, pagesOf(lib));
            dispatch({
                type: "settle", run, warning: failure, ai: {
                    status: "done",
                    untrimmed: diffSuggestions(reviewed, target, base),
                    trimmed: diffSuggestions(reviewed, fitted.selection, base, fitted.trim),
                },
            });
        } catch (err) {
            dispatch({ type: "settle", run, warning: null, ai: { status: "failed", message: failure ?? formatTypstError(err) } });
        }
    };

    /** Leaves the questions for the review on `lib`'s working selection. */
    const startReview = (lib: ResumeData, warning: string | null) => {
        const run = ++lastRun.current;
        const tagPlan = buildTailorPlan(job.requirements, lib, caps, aliases);
        dispatch({ type: "review", run, library: lib, plan: tagPlan, requirements: job.requirements, warning });
        setSel(selectionOf(lib));
        setDismissed(new Set());
        void runAi(run, lib, tagPlan);
    };

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    // Start run 1's AI once per mount (the ref survives Strict Mode's double effect).
    useEffect(() => {
        if (started.current || !review) return;
        started.current = true;
        void runAi(review.run, review.library, review.plan);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const applied = applySelection(library, sel);
    const suggestions = ai.status === "done" ? (allowMultiPage ? ai.untrimmed : ai.trimmed) : [];
    const pending = suggestions.filter(s => !dismissed.has(s.id) && isPending(s, sel));

    const accept = (s: TailorSuggestion) => setSel(prev => acceptSuggestion(prev, s));
    const dismiss = (s: TailorSuggestion) => setDismissed(prev => new Set(prev).add(s.id));
    const acceptAll = () => setSel(prev => pending.reduce(acceptSuggestion, prev));

    const fit = (plan: TailorPlan) => void action.run("fit", async () => {
        const result = await ensureTypst()
            .then(() => fitToOnePage(plan, sel, library, pagesOf(library)))
            .catch((err: unknown) => { throw new Error(formatTypstError(err)); });
        setSel({ ...result.selection, layout: sel.layout });
        setTrimNotes(prev => {
            const next: TrimNotes = { items: { ...prev.items }, keys: { ...prev.keys } };
            for (const id of result.trim.items) next.items[id] = TRIM_ITEM_REASON;
            for (const [id, keys] of Object.entries(result.trim.keys)) next.keys[id] = { ...next.keys[id], ...Object.fromEntries(keys.map(k => [k, TRIM_KEY_REASON])) };
            return next;
        });
        // Trimming is done: the remaining one-page suggestions no longer apply.
        setDismissed(prev => new Set([...prev, ...suggestions.filter(s => s.source === "trim").map(s => s.id)]));
        // The trim above stays applied; the message says why it is still over a page.
        if (result.pages > 1) throw new Error("Could not fit one page without removing locked content. Switch something off or allow more pages.");
    });

    const close = async () => {
        if (action.running) return;
        const layoutChanged = JSON.stringify(applied.layout) !== JSON.stringify(library.layout);
        if (!review || (!layoutChanged && selectionEquals(library, selectedIds(applied), selectedHidden(applied)))) { onClose(); return; }
        const settled = await action.run("close", async () => {
            await applyWorkingSelection({ items: selectedIds(applied), hidden: selectedHidden(applied), layout: layoutChanged ? applied.layout : undefined });
        }, "Could not apply the selection.");
        if (!settled?.ok) return;
        router.refresh();
        onClose("Applied your changes to the working selection.");
    };

    const save = async (download: boolean) => {
        const settled = await action.run(download ? "download" : "save", async () => {
            try {
                // Compile first so a Typst error leaves nothing half-saved.
                const bytes = download ? await compilePdf(toTypstDoc(applied)) : null;
                const r = await createVariantFromPlan({ name, labels: [job.company].filter(Boolean), items: selectedIds(applied), hidden: selectedHidden(applied), layout: applied.layout });
                return { bytes, missing: r.missing };
            } catch (err) {
                throw download ? new Error(formatTypstError(err)) : err;
            }
        }, "Could not create the variant.");
        if (!settled?.ok || !settled.result) return;
        const { bytes, missing } = settled.result;
        if (bytes) {
            const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
            const a = document.createElement("a");
            a.href = url;
            a.download = pdfFileName(library.personalInfo);
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        }
        router.refresh();
        onClose(`Created and loaded "${name}"${bytes ? " and downloaded the PDF" : ""}.${missing ? ` ${missing} items no longer existed and were skipped.` : ""}`);
    };

    return (
        <Dialog
            open
            onClose={() => void close()}
            size="lg"
            title={`Tailor résumé for ${job.title}`}
            description={!review ? "Step 1 of 2 · requirements your library doesn't show yet" : "Step 2 of 2 · pick what goes on the résumé"}
            footer={review ? (
                <ReviewFooter
                    scoreOpts={scoreOptionsFor(job)}
                    library={library}
                    applied={applied}
                    requirements={requirements}
                    aliases={aliases}
                    allowMultiPage={allowMultiPage}
                    onAllowMultiPage={setAllowMultiPage}
                    name={name}
                    onName={setName}
                    busy={action.running}
                    onFit={() => fit(review.plan)}
                    onClose={close}
                    onSave={() => void save(false)}
                    onDownload={() => void save(true)}
                />
            ) : (
                <Button variant="ghost" onClick={() => onClose()}>Close</Button>
            )}
        >
            <div className="space-y-4">
                {action.error && <NoticeBanner tone="danger" onDismiss={action.reset}>{action.error}</NoticeBanner>}
                {review?.warning && <NoticeBanner tone="warning" onDismiss={() => dispatch({ type: "dismissWarning" })}>{review.warning}</NoticeBanner>}

                {!review && (
                    <SkillQuestions
                        gaps={gaps}
                        declined={declined}
                        library={library}
                        saveLabel="Save & continue"
                        skipLabel="Skip"
                        onSkip={() => startReview(library, null)}
                        onSaved={(r) => {
                            // The server's copy: new content and tags, and the categories a Yes switched on. Before
                            // the review opens the dialog has no selection of its own, so nothing local is lost.
                            setDeclined(r.declined);
                            router.refresh();
                            startReview(r.resume, r.warning ?? null);
                        }}
                    />
                )}

                {review && (
                    <>
                        <ReviewToolbar
                            ai={ai}
                            pendingCount={pending.length}
                            onAcceptAll={acceptAll}
                            showPreview={showPreview}
                            onTogglePreview={() => setShowPreview(v => !v)}
                            missingMust={scoreJob(requirements, applied, aliases).missingMust}
                        />
                        {showPreview ? (
                            <ResumePreview resumeData={applied} hideDownload />
                        ) : (
                            <ReviewList
                                plan={review.plan}
                                library={library}
                                sel={sel}
                                onChange={setSel}
                                pending={pending}
                                onAccept={accept}
                                onDismiss={dismiss}
                                warnings={overrideWarnings(review.plan, sel, library, requirements)}
                                trimNotes={trimNotes}
                            />
                        )}
                    </>
                )}
            </div>
        </Dialog>
    );
}

// ---------- review

function ReviewToolbar({ ai, pendingCount, onAcceptAll, showPreview, onTogglePreview, missingMust }: {
    ai: TailorAi; pendingCount: number; onAcceptAll: () => void; showPreview: boolean; onTogglePreview: () => void; missingMust: Requirement[];
}) {
    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
                <p className="flex min-w-0 flex-1 items-center gap-1.5 text-13 text-fg-muted" aria-live="polite">
                    {ai.status === "running" ? (
                        <><Loader2 className="size-3.5 animate-spin" aria-hidden /> AI is reviewing your selection… keep editing, suggestions appear here.</>
                    ) : ai.status === "failed" ? (
                        <span className="text-warning">No suggestions: {ai.message}</span>
                    ) : pendingCount > 0 ? (
                        <><Sparkles className="size-3.5 text-fg" aria-hidden /> {pendingCount} {pendingCount === 1 ? "suggestion" : "suggestions"}, outlined below.</>
                    ) : (
                        <><Sparkles className="size-3.5" aria-hidden /> No open suggestions.</>
                    )}
                </p>
                {pendingCount > 0 && <Button size="sm" onClick={onAcceptAll}>Accept all ({pendingCount})</Button>}
                <Button size="sm" variant={showPreview ? "secondary" : "ghost"} icon={Eye} aria-pressed={showPreview} onClick={onTogglePreview}>
                    {showPreview ? "Back to list" : "Preview"}
                </Button>
            </div>
            {missingMust.length > 0 && (
                <p className="text-xs text-warning">Missing must-haves on this résumé: <span className="font-medium">{missingMust.map(r => r.display).join(", ")}</span></p>
            )}
        </div>
    );
}

function SuggestionLine({ s, onAccept, onDismiss, subject }: { s: TailorSuggestion; onAccept: () => void; onDismiss: () => void; subject: string }) {
    const verb = s.kind === "item" ? (s.include ? "including" : "excluding") : (s.hide ? "hiding" : "showing");
    return (
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="inline-flex min-w-0 items-center gap-1 text-fg">
                <Sparkles className="size-3 shrink-0" aria-hidden />
                <span>{s.source === "trim" ? "To fit one page, suggests" : "AI suggests"} {verb}{subject ? ` ${subject}` : ""}: <span className="text-fg-muted">{s.reason}</span></span>
            </span>
            <span className="inline-flex gap-1">
                <button type="button" onClick={onAccept} className={cn("press rounded-sm px-1.5 py-0.5 font-medium text-fg underline-offset-2 hover:underline", FOCUS_RING)}>Accept</button>
                <button type="button" onClick={onDismiss} className={cn("press rounded-sm px-1.5 py-0.5 text-fg-muted underline-offset-2 hover:text-fg hover:underline", FOCUS_RING)}>Dismiss</button>
            </span>
        </span>
    );
}

function ReviewList({ plan, library, sel, onChange, pending, onAccept, onDismiss, warnings, trimNotes }: {
    plan: TailorPlan; library: ResumeData; sel: TailorSelection; onChange: (s: TailorSelection) => void;
    pending: TailorSuggestion[]; onAccept: (s: TailorSuggestion) => void; onDismiss: (s: TailorSuggestion) => void;
    warnings: ReturnType<typeof overrideWarnings>; trimNotes: TrimNotes;
}) {
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const itemOf = (id: string, section: ResumeListKey) => (library[section] as ResumeData[ResumeListKey][number][]).find(it => it.id === id);
    const included = plan.items.filter(d => sel.include[d.id]).length;
    // Order is part of the selection: dragging here reorders the résumé that Close / Save write.
    const layout = sel.layout ?? library.layout;
    const sectionKeys = layout.sectionOrder.filter((id): id is ResumeListKey => id !== "summary" && plan.items.some(d => d.section === id));
    const rowsOf = (key: ResumeListKey) => {
        const decisions = new Map(plan.items.filter(d => d.section === key).map(d => [d.id, d]));
        return orderedItems(key, library[key] as ResumeData[ResumeListKey][number][], layout).flatMap(it => decisions.get(it.id) ?? []);
    };

    return (
        <div className="space-y-5">
            <p className="text-13 text-fg-muted">
                {included} of {plan.items.length} items included.
                <span className="inline-flex items-center gap-1 pl-2 text-fg-subtle"><Lock className="size-3" aria-hidden /> marks items that cover hard requirements.</span>
            </p>
            <SortableList
                ids={sectionKeys}
                labelOf={id => SECTION_LABEL[id as ResumeListKey]}
                onMove={(activeId, overId) => onChange({ ...sel, layout: moveSection(layout, activeId as SectionId, overId as SectionId) })}
            >
            <div className="space-y-5">
            {sectionKeys.map(key => {
                const rows = rowsOf(key);
                const rowIds = rows.map(d => d.id);
                return (
                    <SortableBlock key={key} id={key} label={SECTION_LABEL[key]} as="section" className="space-y-2 bg-surface">
                        {handle => (<>
                        <h3 className="flex items-center gap-1 text-13 font-medium text-fg">
                            {handle}{SECTION_LABEL[key]} <span className="text-fg-subtle tabular-nums">{rows.filter(d => sel.include[d.id]).length}/{rows.length}</span>
                        </h3>
                        <SortableList
                            ids={rowIds}
                            labelOf={id => { const d = rows.find(r => r.id === id); const it = d && itemOf(d.id, d.section); return it ? itemTitle(key, it) : "item"; }}
                            onMove={(activeId, overId) => onChange({ ...sel, layout: moveItem(layout, key, rowIds, activeId, overId) })}
                        >
                        <ul className="divide-y divide-border rounded-lg border border-border">
                            {rows.map(d => {
                                const on = sel.include[d.id] ?? false;
                                const item = itemOf(d.id, d.section);
                                const entries = item ? subEntriesOf(d.section, item) : [];
                                const hidden = sel.hidden[d.id] ?? [];
                                const itemSuggestion = pending.find(s => s.kind === "item" && s.itemId === d.id);
                                const subSuggestions = pending.filter((s): s is Extract<TailorSuggestion, { kind: "sub" }> => s.kind === "sub" && s.itemId === d.id);
                                const keyWarnings = warnings.keys[d.id] ?? {};
                                const isOpen = expanded.has(d.id);
                                const noun = d.section === "skills" ? "Skills" : "Bullets";
                                const labelOf = (k: string) => entries.find(e => e.key === k)?.label ?? k;
                                return (
                                    <SortableBlock key={d.id} id={d.id} label={d.label} as="li" className={cn("bg-surface px-3 py-2.5", !on && "bg-surface-muted/50", itemSuggestion && "rounded-md ai-glow")}>
                                        {handle => (<>
                                        <div className="flex items-start gap-3">
                                            <span className="-my-1 -ml-2">{handle}</span>
                                            <Switch checked={on} onChange={v => onChange(setInclude(sel, d.id, v))} label={on ? "Included" : "Excluded"} className="mt-0.5" />
                                            <div className="min-w-0 flex-1">
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    <span className={cn("truncate text-sm font-medium", on ? "text-fg" : "text-fg-muted")}>{d.label}</span>
                                                    {d.locked && (
                                                        <Badge size="xs" tone="strong" title={d.hard.length ? `Covers ${d.hard.join(", ")}` : "Recommended to keep"}>
                                                            <Lock className="mr-1 size-2.5" aria-hidden />{d.hard.length ? "Hard requirement" : "Recommended"}
                                                        </Badge>
                                                    )}
                                                    {hidden.length > 0 && on && <span className="text-xs text-fg-subtle">{hidden.length} hidden</span>}
                                                </div>
                                                <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">{d.reason}</p>
                                                {d.soft.length > 0 && d.hard.length === 0 && <p className="text-xs text-fg-subtle">Soft: {d.soft.join(", ")}</p>}
                                                {!on && trimNotes.items[d.id] && <p className="text-xs text-fg-subtle">{trimNotes.items[d.id]}</p>}
                                                {warnings.items[d.id] && <p className="mt-1 text-xs text-warning">{warnings.items[d.id]}</p>}
                                                {itemSuggestion && <SuggestionLine s={itemSuggestion} subject="" onAccept={() => onAccept(itemSuggestion)} onDismiss={() => onDismiss(itemSuggestion)} />}
                                                {!isOpen && on && Object.keys(keyWarnings).length > 0 && (
                                                    <p className="mt-1 text-xs text-warning">{Object.keys(keyWarnings).length} hidden {d.section === "skills" ? "skill names" : "line names"} a hard requirement. Open {noun.toLowerCase()} to see why.</p>
                                                )}
                                            </div>
                                            {entries.length > 0 && on && (
                                                <button
                                                    type="button"
                                                    onClick={() => setExpanded(prev => { const n = new Set(prev); if (n.has(d.id)) n.delete(d.id); else n.add(d.id); return n; })}
                                                    aria-expanded={isOpen}
                                                    className={cn("press inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-fg-muted hover:bg-surface-hover hover:text-fg", subSuggestions.length > 0 && "text-fg ring-1 ring-accent", FOCUS_RING)}
                                                >
                                                    {noun}
                                                    {subSuggestions.length > 0 && <span className="inline-flex items-center gap-0.5 tabular-nums"><Sparkles className="size-3" aria-hidden />{subSuggestions.length}</span>}
                                                    <ChevronDown className={cn("size-3.5 transition-move", isOpen && "rotate-180")} aria-hidden />
                                                </button>
                                            )}
                                        </div>
                                        <Reveal open={isOpen && on && entries.length > 0}>
                                            <div className="mt-3 space-y-2 pl-11 text-13">
                                                <SubItemList
                                                    idPrefix={`tailor-${d.id}`}
                                                    entries={entries}
                                                    hidden={hidden}
                                                    notes={{ ...plan.hiddenReasons[d.id], ...trimNotes.keys[d.id] }}
                                                    highlighted={subSuggestions.map(s => s.key)}
                                                    onToggle={k => onChange(setHidden(sel, d.id, k, !hidden.includes(k)))}
                                                    variant={d.section === "skills" ? "chips" : "bullets"}
                                                    renderExtra={(e) => {
                                                        const s = subSuggestions.find(x => x.key === e.key);
                                                        return (
                                                            <>
                                                                {keyWarnings[e.key] && <span className="block text-xs text-warning">{keyWarnings[e.key]}</span>}
                                                                {s && <SuggestionLine s={s} subject="" onAccept={() => onAccept(s)} onDismiss={() => onDismiss(s)} />}
                                                            </>
                                                        );
                                                    }}
                                                />
                                                {/* Chips have no room underneath: list their warnings and suggestions below. */}
                                                {d.section === "skills" && (
                                                    <div className="space-y-1">
                                                        {Object.entries(keyWarnings).map(([k, text]) => <p key={k} className="text-xs text-warning"><span className="font-medium">{labelOf(k)}</span>: {text}</p>)}
                                                        {subSuggestions.map(s => <SuggestionLine key={s.id} s={s} subject={`"${labelOf(s.key)}"`} onAccept={() => onAccept(s)} onDismiss={() => onDismiss(s)} />)}
                                                    </div>
                                                )}
                                            </div>
                                        </Reveal>
                                        </>)}
                                    </SortableBlock>
                                );
                            })}
                        </ul>
                        </SortableList>
                        </>)}
                    </SortableBlock>
                );
            })}
            </div>
            </SortableList>
        </div>
    );
}

/** A sortable element whose drag handle is placed by the render prop. */
function SortableBlock({ id, label, as: Tag, className, children }: { id: string; label: string; as: "li" | "section"; className?: string; children: (handle: React.ReactNode) => React.ReactNode }) {
    const { rowRef, style, handle } = useSortableRow(id, label);
    return <Tag ref={rowRef} style={style} className={className}>{children(handle)}</Tag>;
}

function ReviewFooter({
    scoreOpts, library, applied, requirements, aliases, allowMultiPage, onAllowMultiPage, name, onName, busy, onFit, onClose, onSave, onDownload,
}: {
    scoreOpts: ScoreOptions; library: ResumeData; applied: ResumeData; requirements: Requirement[]; aliases: AliasMap;
    allowMultiPage: boolean; onAllowMultiPage: (v: boolean) => void; name: string; onName: (v: string) => void;
    busy: Action | null; onFit: () => void; onClose: () => void; onSave: () => void; onDownload: () => void;
}) {
    const score = scoreJob(requirements, applied, aliases, scoreOpts).score;
    const before = scoreJob(requirements, library, aliases, scoreOpts).score;
    const { pages, error: pageError } = useResumePageCount(applied);
    const over = pages !== null && pages > 1;
    const blocked = (over && !allowMultiPage) || pages === null || !name.trim();
    const blockedTitle = over && !allowMultiPage ? "Over one page: fit it, switch something off, or allow more pages" : undefined;

    return (
        <div className="flex w-full flex-col gap-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="flex items-center gap-3">
                    <ScoreRing score={score} size={36} />
                    <div className="text-xs leading-tight">
                        <p className="font-medium text-fg tabular-nums">{score} <span className="font-normal text-fg-subtle">vs {before} now</span></p>
                        <p className={cn("tabular-nums", over ? (allowMultiPage ? "text-warning" : "text-danger") : "text-fg-muted")}>{pages === null ? (pageError ? "Couldn't count pages" : "Counting pages…") : `${pages} ${pages === 1 ? "page" : "pages"}`}</p>
                    </div>
                </div>
                {over && <Button size="sm" onClick={onFit} loading={busy === "fit"} disabled={busy !== null && busy !== "fit"}>Fit to one page</Button>}
                <label className="flex items-center gap-2 text-xs text-fg-muted">
                    <Checkbox checked={allowMultiPage} onChange={e => onAllowMultiPage(e.target.checked)} />
                    Allow more than one page
                </label>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                <Input value={name} onChange={e => onName(e.target.value)} aria-label="Variant name" className="h-8 text-13 sm:mr-auto sm:w-64" />
                <Button variant="ghost" onClick={onClose} loading={busy === "close"} disabled={busy !== null && busy !== "close"} title="Apply these choices to your working selection and close">Close</Button>
                <Button variant="secondary" onClick={onSave} loading={busy === "save"} disabled={blocked || (busy !== null && busy !== "save")} title={blockedTitle}>Save variant</Button>
                <Button variant="primary" icon={Download} onClick={onDownload} loading={busy === "download"} disabled={blocked || (busy !== null && busy !== "download")} title={blockedTitle}>
                    Save variant & download PDF
                </Button>
            </div>
        </div>
    );
}
