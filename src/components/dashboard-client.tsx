"use client";

import React, { Suspense, useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { updateLayout } from "@/app/actions/layout-actions";
import type { ResumeTheme } from "@/lib/layout/theme";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import type { ResumeData, ResumeListKey } from "@/types/schema";
import { RESUME_LIST_KEYS } from "@/types/schema";
import type { ResumeVariant } from "@/types/db";
import type { JobRecord, Preferences, Proposal } from "@/lib/match/types";
import type { AliasMap } from "@/lib/tags/normalize";
import { ResumeForm } from "@/components/ui/editor/resume-form";
import { LibraryView, libraryCounts, type LibraryLists } from "@/components/ui/library/library-view";
import { ResumeImport } from "@/components/ui/resume-import";
import { StaleTagsNotice } from "@/components/ui/library/stale-tags-notice";
import { JobMatchView, type ExternalResume } from "@/components/ui/job-match-view";
import { VariantToolbar } from "@/components/ui/variant-toolbar";
import { SectionTabs, type SectionTab } from "@/components/ui/section-tabs";
import { TopBar } from "@/components/ui/primitives/top-bar";
import { Button, IconButton } from "@/components/ui/primitives/button";
import { ConfirmDialog, Dialog } from "@/components/ui/primitives/dialog";
import { NoticeBanner } from "@/components/ui/primitives/notice-banner";
import { PanelRight, PenLine, Search, Upload } from "@/components/ui/primitives/icons";
import { Input } from "@/components/ui/primitives/field";
import { jobHref, parseView, useDashboardView, VIEW_TITLE, viewHref } from "@/lib/ui/use-dashboard-view";
import { setLeaveGuard } from "@/lib/ui/leave-guard";
import { useMediaQuery, XL } from "@/lib/ui/use-media-query";
import { PANE_MIN, setPreviewPane, togglePreviewPane, usePreviewPane, usePreviewPaneWidth } from "@/lib/ui/preview-pane-store";
import { PaneResizeHandle } from "@/components/ui/pane-resize-handle";
import { saveResumeData } from "@/app/actions/resume-actions";
import { updateExperience } from "@/app/actions/experience-actions";
import { updateEducation } from "@/app/actions/education-actions";
import { updateSkill } from "@/app/actions/skill-actions";
import { updateProject } from "@/app/actions/project-actions";
import { updateCertification } from "@/app/actions/certification-actions";
import { updateAward } from "@/app/actions/award-actions";
import { updateVolunteering } from "@/app/actions/volunteering-actions";
import { updatePublication } from "@/app/actions/publication-actions";
import { updateLanguage } from "@/app/actions/language-actions";
import { updateCustomEntry } from "@/app/actions/custom-actions";
import { mergeImport, type ImportSelection } from "@/lib/import/merge";
import { contentHashOf, staleInputs } from "@/lib/tags/content";
import { applyProposal } from "@/lib/match/proposals";
import { itemTitle } from "@/lib/sections";
import { cn } from "@/lib/cn";
import { overCapItems } from "@/lib/text/word-count";
import { invalidDateItems } from "@/lib/validation/dates";
import { contactBlocking } from "@/lib/contact/normalize";
import type { LinkChecks } from "@/lib/contact/types";
import { kickLinkCheck } from "@/lib/ui/link-check";
import { dismissAboutNudge, useAboutNudgeDismissed } from "@/lib/ui/about-nudge-store";
import type { CharacterizationSummary } from "@/app/actions/about-actions";
import Link from "next/link";
import type { ItemReview } from "@/lib/review/types";
import { isBriefOutdated, lowScoreItems, reviewStaleInputs, type ReviewMap } from "@/lib/review/content";
import { kickReviews, reReviewAll } from "@/lib/ui/review-runner";
import { ActionItemsCard, type OpenItem } from "@/components/ui/action-items-card";
import { Switch } from "@/components/ui/primitives/switch";
import { setAdvancedLayout, useAdvancedLayout } from "@/lib/ui/advanced-layout-store";

// The preview compiles Typst in the browser (wasm), so it must never render on the server.
const ResumePreview = dynamic(
    () => import("@/components/ui/resume-preview").then(m => m.ResumePreview),
    {
        ssr: false,
        loading: () => (
            <div className="mx-auto flex aspect-[210/297] w-full max-w-[210mm] items-center justify-center border border-border bg-paper">
                <span className="text-13 text-fg-subtle">Loading preview…</span>
            </div>
        ),
    },
);

const UPDATE_ACTION: Record<ResumeListKey, (id: string, fd: FormData) => Promise<void>> = {
    workExperience: updateExperience,
    education: updateEducation,
    skills: updateSkill,
    projects: updateProject,
    certifications: updateCertification,
    awards: updateAward,
    volunteering: updateVolunteering,
    publications: updatePublication,
    languages: updateLanguage,
    custom: updateCustomEntry,
};

interface DashboardClientProps extends LibraryLists {
    /** Complete editor model built on the server (profile + all subcollections). */
    initialResumeData: ResumeData;
    variants: ResumeVariant[];
    variantUsage: Record<string, string[]>;
    loadedVariantId: string | null;
    jobs: JobRecord[];
    preferences: Preferences;
    tagAliases: AliasMap;
    userName: string;
    linkChecks: LinkChecks;
    about: CharacterizationSummary;
    profileReview: ItemReview | null;
}

type Notice = { tone: "ok" | "warn"; text: string };
type PendingDelete = { section: ResumeListKey; id: string };

export default function DashboardClient(props: DashboardClientProps) {
    // useSearchParams (inside useDashboardView) needs a Suspense boundary.
    return (
        <Suspense fallback={null}>
            <DashboardClientInner {...props} />
        </Suspense>
    );
}

function DashboardClientInner({
    initialResumeData,
    experiences, educations, skills, projects, certifications, awards, volunteering, publications, languages, custom,
    variants,
    variantUsage,
    loadedVariantId,
    jobs,
    preferences,
    tagAliases,
    linkChecks,
    about,
    profileReview,
}: DashboardClientProps) {
    const router = useRouter();
    const [view, setView] = useDashboardView();
    const advancedLayout = useAdvancedLayout();
    const aboutNudgeDismissed = useAboutNudgeDismissed();
    const wide = useMediaQuery(XL);
    const paneWanted = usePreviewPane();
    const paneOpen = wide && paneWanted && view !== "preview";
    const storedPaneWidth = usePreviewPaneWidth();
    const [dragWidth, setDragWidth] = useState<number | null>(null);
    const paneWidth = dragWidth ?? storedPaneWidth;
    const gridRef = useRef<HTMLDivElement>(null);

    const [libraryTab, setLibraryTab] = useState<SectionTab>("all");
    const [libraryQuery, setLibraryQuery] = useState("");
    const [editorTab, setEditorTab] = useState<SectionTab>("all");
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [notice, setNotice] = useState<Notice | null>(null);
    /** Variants affected by the edits being saved, and where to go after saving (null = Library). */
    const [confirmVariants, setConfirmVariants] = useState<{ names: string[]; target: string | null } | null>(null);
    const [confirmDiscard, setConfirmDiscard] = useState(false);
    /** In-app navigation away from the editor with unsaved changes, waiting for Save / Discard / Keep editing. */
    const [pendingLeave, setPendingLeave] = useState<string | null>(null);
    /** Item to open when the editor (re)mounts from an Action items link; the nonce remounts the form. */
    const [focusItem, setFocusItem] = useState<{ id: string; nonce: number } | null>(null);

    // Job Match state
    // The open job lives in the URL (?view=jobs&job=<id>) so a job page can be linked to and Back returns to the board.
    const searchParams = useSearchParams();
    const selectedJobId = view === "jobs" ? searchParams.get("job") : null;
    const setSelectedJobId = (id: string | null) => router.push(jobHref(id), { scroll: false });
    const [externalResume, setExternalResume] = useState<ExternalResume | null>(null);

    // Draft model: `draft` is null unless the editor is open. Everything else
    // reads server truth from props, which Next refreshes after each server
    // action (revalidatePath). Because the draft is never re-derived from
    // props, a revalidation can't clobber unsaved edits. The draft only lives
    // in the editor: other views always read server truth (so a draft can never
    // hide what Job Match / variants just wrote), leaving the editor asks to
    // save or discard, and leaving through browser Back discards it.
    const [draft, setDraft] = useState<ResumeData | null>(null);
    /** Saved items removed in the editor: deleted by saveResumeData, forgotten on Discard. */
    const [pendingDeletes, setPendingDeletes] = useState<PendingDelete[]>([]);
    const editorDraft = draft ?? initialResumeData;
    const resumeData = view === "editor" ? editorDraft : initialResumeData;
    const [optimisticLayout, setOptimisticLayout] = useOptimistic(initialResumeData.layout);
    const [, startThemeTransition] = useTransition();
    // The preview shows the optimistic layout (template picks land before the server round-trip).
    const previewData = view === "editor" ? editorDraft : { ...initialResumeData, layout: optimisticLayout };
    const dirty = draft !== null && (pendingDeletes.length > 0 || JSON.stringify(draft) !== JSON.stringify(initialResumeData));

    // Sidebar links ask before leaving an editor with unsaved changes; reload / closing the tab gets the browser prompt.
    useEffect(() => {
        if (view !== "editor" || !dirty) return;
        const uninstall = setLeaveGuard(href => {
            if (href === viewHref("editor")) return false;
            setPendingLeave(href);
            return true;
        });
        const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
        window.addEventListener("beforeunload", onBeforeUnload);
        return () => {
            uninstall();
            window.removeEventListener("beforeunload", onBeforeUnload);
        };
    }, [view, dirty]);

    // Browser Back / Forward out of the editor cannot be intercepted: the draft is reverted.
    const hasDraft = draft !== null;
    useEffect(() => {
        if (!hasDraft) return;
        const onPop = () => {
            const url = new URL(window.location.href);
            if (url.pathname !== "/dashboard" || parseView(url.searchParams.get("view")) !== "editor") {
                setDraft(null);
                setPendingDeletes([]);
                setSaveError(null);
            }
        };
        window.addEventListener("popstate", onPop);
        return () => window.removeEventListener("popstate", onPop);
    }, [hasDraft]);

    // Coach reviews come with the library rows; the model items decide staleness.
    const reviews: ReviewMap = Object.fromEntries(
        [experiences, educations, skills, projects, certifications, awards, volunteering, publications, languages, custom].flat().map(r => [r.id, r.review]),
    );
    const refresh = () => router.refresh();
    // Library: review whatever changed since its last review (Library edits, accepted suggestions, Job Match
    // answers). Keyed on the ids, so each set of changes is attempted once (see review-runner.ts).
    const staleReviewSig = view === "library" ? reviewStaleInputs(initialResumeData, reviews, profileReview).map(i => i.id).sort().join(",") : "";
    useEffect(() => {
        if (!staleReviewSig) return;
        kickReviews({ signature: staleReviewSig, onDone: r => { if (r.reviewed > 0) router.refresh(); } });
    }, [staleReviewSig, router]);
    const outdatedReviews = about.briefHash
        ? Object.values(reviews).filter(r => isBriefOutdated(r, about.briefHash)).length + (isBriefOutdated(profileReview, about.briefHash) ? 1 : 0)
        : 0;
    const [reReviewing, setReReviewing] = useState(false);
    const [confirmReReview, setConfirmReReview] = useState(false);

    const updateDraft = (updater: (prev: ResumeData) => ResumeData) => {
        setDraft(prev => updater(prev ?? initialResumeData));
    };

    // Template / accent / fonts / paper. In the editor it is part of the draft (saved with Save & Exit);
    // everywhere else it is written straight to the working layout, shown optimistically meanwhile.
    const changeTheme = (theme: ResumeTheme) => {
        if (view === "editor") {
            updateDraft(prev => ({ ...prev, layout: { ...prev.layout, theme } }));
            return;
        }
        const next = { ...initialResumeData.layout, theme };
        startThemeTransition(async () => {
            setOptimisticLayout(next);
            try {
                await updateLayout(next);
                router.refresh();
            } catch {
                setNotice({ tone: "warn", text: "Couldn't save the template. Try again." });
            }
        });
    };

    const openItem: OpenItem = (section, id) => {
        setFocusItem(prev => ({ id, nonce: (prev?.nonce ?? 0) + 1 }));
        openEditor(section === "summary" || section === "profile" ? "profile" : "all");
    };

    const openEditor = (tab?: SectionTab) => {
        // Keep an in-progress draft (e.g. one seeded by an import) if there is one.
        setDraft(prev => prev ?? initialResumeData);
        setSaveError(null);
        if (tab) setEditorTab(tab);
        setView("editor");
    };

    const doDiscard = () => {
        setConfirmDiscard(false);
        setDraft(null);
        setPendingDeletes([]);
        setSaveError(null);
        setNotice(null);
        setView("library", { replace: true });
    };
    const discardDraft = () => {
        if (dirty) setConfirmDiscard(true);
        else doDiscard();
    };

    /** Ids of persisted items whose content changed (or that were deleted) in the draft. */
    const changedItemIds = (): string[] => {
        if (!draft) return [];
        const out: string[] = pendingDeletes.map(d => d.id);
        for (const key of RESUME_LIST_KEYS) {
            const before = new Map((initialResumeData[key] as ResumeData[ResumeListKey][number][]).map(it => [it.id, it]));
            for (const item of draft[key] as ResumeData[ResumeListKey][number][]) {
                const prev = before.get(item.id);
                if (prev && contentHashOf(key, prev) !== contentHashOf(key, item)) out.push(item.id);
            }
        }
        return out;
    };

    /** Saves the draft, then goes to `target` (another page / view) or back to the Library. */
    const doSave = async (target: string | null = null) => {
        if (!draft) return;
        if (invalidDateItems(draft).length > 0 || contactBlocking(draft.personalInfo)) return;
        setConfirmVariants(null);
        setIsSaving(true);
        setSaveError(null);
        try {
            const result = await saveResumeData(draft, { deleted: pendingDeletes });
            if (!result.success) {
                setSaveError(result.error);
                if (result.field) { openItem("profile", `pi-${result.field}`); return; }
                const bad = invalidDateItems(draft).find(i => i.id === result.invalidIds[0]);
                if (bad) openItem(bad.section, bad.id);
                return;
            }
            const before = initialResumeData.personalInfo;
            if ((["github", "linkedin", "website"] as const).some(k => draft.personalInfo[k] !== before[k])) kickLinkCheck(() => router.refresh());
            setDraft(null);
            setPendingDeletes([]);
            kickReviews({ onDone: r => { if (r.reviewed > 0) refresh(); } });
            setNotice(result.tagWarning
                ? { tone: "warn", text: `Saved. Skill analysis did not finish: ${result.tagWarning}` }
                : result.tagged > 0
                    ? { tone: "ok", text: `Saved. Analysed skills for ${result.tagged} ${result.tagged === 1 ? "item" : "items"}.` }
                    : { tone: "ok", text: "Saved." });
            if (target) router.push(target, { scroll: false });
            else setView("library", { replace: true });
        } catch (error) {
            console.error("Failed to save:", error);
            setSaveError(error instanceof Error ? error.message : "Failed to save your library changes.");
        } finally {
            setIsSaving(false);
        }
    };

    const handleSaveAndExit = (target: string | null = null) => {
        if (!draft) {
            if (target) router.push(target, { scroll: false });
            else setView("library", { replace: true });
            return;
        }
        const affected = [...new Set(changedItemIds().flatMap(id => variantUsage[id] ?? []))];
        if (affected.length > 0) { setConfirmVariants({ names: affected, target }); return; }
        void doSave(target);
    };

    const leaveDiscarding = () => {
        const href = pendingLeave;
        setPendingLeave(null);
        setDraft(null);
        setPendingDeletes([]);
        setSaveError(null);
        setNotice(null);
        if (href) router.push(href, { scroll: false });
    };
    const leaveSaving = () => {
        const href = pendingLeave;
        setPendingLeave(null);
        handleSaveAndExit(href);
    };

    const handleImport = (selection: ImportSelection, meta: { fileNames: string[] }) => {
        const merged = mergeImport(draft ?? initialResumeData, selection);
        setDraft(merged.data);
        const src = meta.fileNames.length === 1 ? meta.fileNames[0] : `${meta.fileNames.length} files`;
        const parts = [`Imported ${merged.added} new ${merged.added === 1 ? "item" : "items"} from ${src}.`];
        if (merged.updated > 0) parts.push(`${merged.updated} existing ${merged.updated === 1 ? "item gained" : "items gained"} detail.`);
        if (merged.unchanged > 0) parts.push(`${merged.unchanged} already in your library ${merged.unchanged === 1 ? "was" : "were"} skipped.`);
        parts.push("Review below, then Save & Exit to keep them.");
        setNotice({ tone: "ok", text: parts.join(" ") });
        setSaveError(null);
        setEditorTab("all");
        setView("editor");
    };

    /** Applies a Job Match proposal: selection changes go to the server unless a draft is open; text edits open the editor. */
    const handleApplyProposal = async (job: JobRecord, p: Proposal) => {
        if (!p.section || !p.itemId) return;
        if (p.kind === "include" || p.kind === "exclude") {
            if (draft) {
                updateDraft(prev => applyProposal(prev, p));
            } else {
                const fd = new FormData();
                fd.set("isSelected", String(p.kind === "include"));
                await UPDATE_ACTION[p.section](p.itemId, fd);
                router.refresh();
            }
            return;
        }
        const next = applyProposal(draft ?? initialResumeData, p);
        setDraft(next);
        const item = (next[p.section] as ResumeData[ResumeListKey][number][]).find(it => it.id === p.itemId);
        setNotice({ tone: "ok", text: `Applied the suggestion to ${item ? itemTitle(p.section, item) : "an item"} for ${job.title}. Review it below, then Save & Exit.` });
        setEditorTab(p.section);
        setView("editor");
    };

    const overCap = overCapItems(resumeData);
    const invalidDates = invalidDateItems(resumeData);
    const blockingContact = view === "editor" ? contactBlocking(editorDraft.personalInfo) : null;
    const editorBlocked = view === "editor" && (invalidDates.length > 0 || blockingContact !== null);

    const lists: LibraryLists = { experiences, educations, skills, projects, certifications, awards, volunteering, publications, languages, custom };
    const counts = libraryCounts(lists);
    const draftCounts = Object.fromEntries(RESUME_LIST_KEYS.map(k => [k, editorDraft[k].length])) as Record<ResumeListKey, number>;

    const previewToggle = wide
        ? <IconButton icon={PanelRight} aria-label={paneWanted ? "Hide preview pane" : "Show preview pane"} aria-pressed={paneWanted} variant={paneWanted ? "secondary" : "ghost"} size="md" onClick={togglePreviewPane} />
        : <Button variant="ghost" onClick={() => setView("preview")}>Preview</Button>;

    const actions =
        view === "editor" ? (
            <>
                <label className="hidden cursor-pointer items-center gap-2 text-13 text-fg-muted md:flex">
                    <Switch checked={advancedLayout} onChange={setAdvancedLayout} label="Advanced layout" />
                    <span aria-hidden>Advanced layout</span>
                </label>
                <span className={cn("hidden items-center gap-1.5 text-13 sm:flex", dirty ? "text-fg-muted" : "text-fg-subtle")} aria-live="polite">
                    <span className={cn("size-1.5 rounded-full", dirty ? "bg-warning" : "bg-border-strong")} aria-hidden />
                    {dirty ? "Unsaved changes" : "No changes"}
                </span>
                <Button variant="ghost" onClick={discardDraft} disabled={isSaving}>Discard</Button>
                {blockingContact && (
                    <Button variant="ghost" className="text-danger" onClick={() => openItem("profile", `pi-${blockingContact.field}`)}>Fix email</Button>
                )}
                {view === "editor" && invalidDates.length > 0 && (
                    <Button variant="ghost" className="text-danger" onClick={() => openItem(invalidDates[0].section, invalidDates[0].id)}>
                        Fix {invalidDates.length} {invalidDates.length === 1 ? "date" : "dates"}
                    </Button>
                )}
                <Button variant="primary" onClick={() => handleSaveAndExit()} loading={isSaving} disabled={editorBlocked} title={editorBlocked ? (blockingContact ? blockingContact.message : "Fix the dates marked in red first") : undefined}>
                    {isSaving ? (staleInputs(resumeData).length > 0 ? "Analysing & saving…" : "Saving…") : "Save & Exit"}
                </Button>
            </>
        ) : view === "library" ? (
            <>
                {outdatedReviews > 0 && (
                    <Button variant="ghost" onClick={() => setConfirmReReview(true)} loading={reReviewing} className="hidden lg:inline-flex" title="Some coach reviews were written before your latest About you answers">
                        Re-review {outdatedReviews}
                    </Button>
                )}
                <Button variant="ghost" icon={Upload} onClick={() => setView("import")} className="hidden sm:inline-flex">Import</Button>
                <Button variant="primary" icon={PenLine} onClick={() => openEditor(libraryTab)}>Edit</Button>
                {previewToggle}
            </>
        ) : view === "preview" ? (
            wide ? <Button variant="secondary" onClick={() => { setPreviewPane(true); setView("library", { replace: true }); }}>Dock as side pane</Button> : null
        ) : (
            <Button variant="ghost" onClick={() => setView("library")}>Back to library</Button>
        );

    const tabs =
        view === "library" ? <SectionTabs counts={counts} value={libraryTab} onChange={setLibraryTab} order={initialResumeData.layout.sectionOrder} />
        : view === "editor" ? <SectionTabs counts={draftCounts} value={editorTab} onChange={setEditorTab} showEmpty withProfile order={editorDraft.layout.sectionOrder} />
        : undefined;

    const body =
        view === "editor" ? (
            <ResumeForm
                key={focusItem?.nonce ?? 0}
                initialOpenId={focusItem?.id ?? null}
                resumeData={editorDraft}
                onChange={updateDraft}
                variantUsage={variantUsage}
                tab={editorTab}
                linkChecks={linkChecks}
                reviews={reviews}
                profileReview={profileReview}
                onDeletePersisted={(section, id) => setPendingDeletes(prev => [...prev, { section, id }])}
            />
        ) : view === "preview" ? (
            <ResumePreview resumeData={previewData} onThemeChange={changeTheme} />
        ) : view === "import" ? (
            <ResumeImport current={draft ?? initialResumeData} onImport={handleImport} onCancel={() => setView("library")} />
        ) : view === "jobs" ? (
            <JobMatchView
                jobs={jobs}
                preferences={preferences}
                aliases={tagAliases}
                variants={variants}
                resumeData={resumeData}
                selectedJobId={selectedJobId}
                onSelectJob={setSelectedJobId}
                onApplyProposal={handleApplyProposal}
                onImportExternal={(r) => {
                    const items: ImportSelection["items"] = {};
                    for (const key of RESUME_LIST_KEYS) if (r.data[key].length) (items[key] as unknown[]) = r.data[key];
                    handleImport({ personalInfo: r.data.personalInfo, replacePersonal: false, items }, { fileNames: [r.fileName] });
                }}
                externalResume={externalResume}
                onExternalResume={setExternalResume}
            />
        ) : (
            <div className="space-y-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="relative w-full sm:max-w-xs">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle" aria-hidden />
                        <Input
                            type="search" value={libraryQuery} onChange={e => setLibraryQuery(e.target.value)}
                            placeholder="Search your library…" aria-label="Search library" className="h-8 pl-8 text-13"
                        />
                    </div>
                    <VariantToolbar
                        variants={variants}
                        loadedVariantId={loadedVariantId}
                        data={initialResumeData}
                        onNotice={(text, tone = "ok") => setNotice({ tone, text })}
                    />
                </div>
                <p className="text-13 text-fg-muted">Toggle items to include them on your résumé. Click a row for details.</p>
                <LibraryView {...lists} tab={libraryTab} query={libraryQuery} onError={text => setSaveError(text)} briefHash={about.briefHash} onReviewed={refresh} variantUsage={variantUsage} resumeData={initialResumeData} onImport={() => setView("import")} onEdit={tab => openEditor(tab)} />
            </div>
        );

    return (
        <>
            <TopBar
                title={VIEW_TITLE[view]}
                actions={actions}
                tabs={tabs}
            />

            <div
                ref={gridRef}
                className={cn("flex-1", paneOpen && "xl:grid")}
                // clamp(): the 50% cap follows window resizes without JS.
                style={paneOpen ? { gridTemplateColumns: `minmax(0,1fr) clamp(${PANE_MIN}px, ${paneWidth}px, 50%)` } : undefined}
            >
                <main className="min-w-0 p-4 pb-16 md:p-6">
                    {/* Job Match is a two-column workspace: let it use the full width left of the pane. */}
                    <div className={cn("mx-auto space-y-4", view === "jobs" ? "max-w-[1600px]" : "max-w-5xl")}>
                        {saveError && <NoticeBanner tone="danger" onDismiss={() => setSaveError(null)}>{saveError}</NoticeBanner>}
                        {notice && (view === "editor" || view === "library") && (
                            <NoticeBanner tone={notice.tone === "ok" ? "success" : "warning"} onDismiss={() => setNotice(null)}>{notice.text}</NoticeBanner>
                        )}
                        {view === "library" && <StaleTagsNotice data={initialResumeData} />}
                        {view === "library" && about.status !== "complete" && !aboutNudgeDismissed && (
                            <NoticeBanner tone="warning" onDismiss={dismissAboutNudge}>
                                Tell us about your goals so AI reviews and tailoring fit where you are in your career.{" "}
                                <Link href="/dashboard/about" className="font-medium underline underline-offset-2">{about.status === "draft" ? "Continue" : "Start"} (2 min)</Link>
                            </NoticeBanner>
                        )}
                        {(view === "editor" || view === "library") && <ActionItemsCard overCap={overCap} invalidDates={invalidDates} lowScore={lowScoreItems(resumeData, reviews, profileReview)} onOpen={openItem} />}
                        {body}
                    </div>
                </main>
                {paneOpen && (
                    <aside className="hidden xl:block sticky top-14 h-[calc(100dvh-3.5rem)] border-l border-border bg-surface-muted/60" aria-label="Résumé preview">
                        <PaneResizeHandle containerRef={gridRef} width={paneWidth} onDrag={setDragWidth} />
                        <ResumePreview resumeData={previewData} compact onClose={() => setPreviewPane(false)} onThemeChange={changeTheme} />
                    </aside>
                )}
            </div>

            <ConfirmDialog
                open={confirmVariants !== null}
                title="These edits affect saved variants"
                confirmLabel="Save anyway"
                busy={isSaving}
                onCancel={() => setConfirmVariants(null)}
                onConfirm={() => void doSave(confirmVariants?.target ?? null)}
            >
                <p>Variants only point at library items, so the changed text will show up in every variant that includes those items:</p>
                <ul className="ml-5 list-disc font-medium text-fg">{confirmVariants?.names.map(v => <li key={v}>{v}</li>)}</ul>
            </ConfirmDialog>

            <Dialog
                open={pendingLeave !== null}
                onClose={() => setPendingLeave(null)}
                title="Leave the editor?"
                footer={
                    <>
                        <Button variant="ghost" onClick={() => setPendingLeave(null)}>Keep editing</Button>
                        <Button variant="secondary" onClick={leaveDiscarding}>Discard changes</Button>
                        <Button variant="primary" onClick={leaveSaving}>Save & leave</Button>
                    </>
                }
            >
                <p>You have unsaved changes. Save them first, or they are discarded when you leave.</p>
            </Dialog>

            <ConfirmDialog
                open={confirmReReview}
                title={`Re-review ${outdatedReviews} ${outdatedReviews === 1 ? "item" : "items"}?`}
                confirmLabel="Re-review"
                onCancel={() => setConfirmReReview(false)}
                onConfirm={() => {
                    setConfirmReReview(false);
                    setReReviewing(true);
                    let done = 0;
                    reReviewAll(
                        r => { done += r.reviewed; setNotice({ tone: "ok", text: `Re-reviewed ${done} ${done === 1 ? "item" : "items"}${r.remaining > 0 ? "…" : "."}` }); },
                        () => { setReReviewing(false); refresh(); },
                    );
                }}
            >
                <p>These coach reviews were written before you updated your About you answers. Your coach reads them again with your current goals; it runs in the background.</p>
            </ConfirmDialog>

            <ConfirmDialog
                open={confirmDiscard}
                title="Discard your unsaved changes?"
                confirmLabel="Discard"
                danger
                onCancel={() => setConfirmDiscard(false)}
                onConfirm={doDiscard}
            >
                <p>Edits and imported items that have not been saved will be lost.</p>
            </ConfirmDialog>
        </>
    );
}
