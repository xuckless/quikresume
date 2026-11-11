"use client";

// The Master Editor: a controlled form over ResumeData. Items are collapsible
// rows; new items open and scroll into view. Saving lives in the top bar
// (dashboard-client.tsx), so this component only edits the draft.
//
// Order is the print order: sections follow `layout.sectionOrder` and items
// `orderedItems` (newest first until dragged). Dragging edits `draft.layout`.
// While an item's dates are being edited it keeps the place it had (`datePins`);
// it settles into its dated place when the row is collapsed or focus leaves it.
// Advanced layout mode adds page, section and item spacing controls.

import React, { useState } from "react";
import type { ResumeData, ResumeListKey } from "@/types/schema";
import { isTempId, newTempId } from "@/lib/ids";
import { isStale } from "@/lib/tags/content";
import { itemTitle, itemLabel, SECTION_LABEL } from "@/lib/sections";
import { itemWordCount } from "@/lib/text/word-count";
import { validateItemDates } from "@/lib/validation/dates";
import { hasManualOrder, isDatedSection, moveItem, moveSection, orderedItemsPinned, pinBeforeEdit, resetItemOrder, type DatePin } from "@/lib/layout/order";
import { ENTRY_SECTIONS } from "@/lib/layout/presets";
import type { ResumeLayout, SectionId } from "@/lib/layout/types";
import type { LinkChecks } from "@/lib/contact/types";
import type { ItemReview, ReviewSuggestion } from "@/lib/review/types";
import { dismissReviewSuggestion } from "@/app/actions/review-actions";
import { isProfileReviewStale, type ReviewMap } from "@/lib/review/content";
import { useAdvancedLayout } from "@/lib/ui/advanced-layout-store";
import type { SectionTab } from "@/components/ui/section-tabs";
import { SECTION_ICON } from "@/components/ui/library/library-view";
import { Button } from "@/components/ui/primitives/button";
import { ArrowDownWideNarrow, User } from "@/components/ui/primitives/icons";
import { SortableList, useSortableRow } from "@/components/ui/primitives/sortable";
import { PersonalInfoSection, SummaryField } from "./personal-info-section";
import { EditorSection } from "./editor-section";
import { EditorItemRow } from "./editor-item-row";
import { SECTION_CONFIG } from "./section-fields";
import { ReviewPanel } from "@/components/ui/review/review-panel";
import { fieldSpec, isReviewStale } from "@/lib/review/content";
import { applySuggestionPatch, visibleSuggestions } from "@/lib/review/apply";
import { ItemLayoutControls, PageLayoutCard, SectionLayoutControls, type LayoutUpdate } from "./layout-controls";

type ItemOf<K extends ResumeListKey> = ResumeData[K][number];

interface ResumeFormProps {
    resumeData: ResumeData;
    /** Functional updater so edits never depend on a stale snapshot. */
    onChange: (updater: (prev: ResumeData) => ResumeData) => void;
    /** Item id -> names of saved variants that include it. */
    variantUsage?: Record<string, string[]>;
    /** Which section to show ("all" shows everything). */
    tab: SectionTab;
    /** Item to open and scroll to on mount (Action items links remount the form with this). "summary" = the summary field, "pi-<field>" a personal info field. */
    initialOpenId?: string | null;
    linkChecks?: LinkChecks;
    /** Coach review per saved item id (read-only here: it describes the last saved text). */
    reviews?: ReviewMap;
    profileReview?: ItemReview | null;
    /** A saved item was removed from the draft (deleted on save, restored by Discard). */
    onDeletePersisted: (section: ResumeListKey, id: string) => void;
}

export const sectionTitle = (id: SectionId) => (id === "summary" ? "Summary" : SECTION_LABEL[id]);

export function ResumeForm({ resumeData, onChange, variantUsage = {}, tab, initialOpenId = null, linkChecks, reviews = {}, profileReview = null, onDeletePersisted }: ResumeFormProps) {
    const advanced = useAdvancedLayout();
    const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set(initialOpenId ? [initialOpenId] : []));
    const [justAddedId, setJustAddedId] = useState<string | null>(initialOpenId);
    const [draggingSection, setDraggingSection] = useState(false);
    // Item id -> dates before its current edit; the display order sorts by these until the row settles.
    const [datePins, setDatePins] = useState<Readonly<Record<string, DatePin>>>({});
    const layout = resumeData.layout;

    const settle = (id: string) => setDatePins(prev => { if (!prev[id]) return prev; const n = { ...prev }; delete n[id]; return n; });

    const toggleOpen = (id: string) => {
        if (openIds.has(id)) settle(id);
        setOpenIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    };

    const updateLayout: LayoutUpdate = fn => onChange(prev => ({ ...prev, layout: fn(prev.layout) }));

    const updatePersonalInfo = (field: keyof ResumeData["personalInfo"], value: string) => {
        onChange(prev => ({ ...prev, personalInfo: { ...prev.personalInfo, [field]: value } }));
    };

    const addItem = <K extends ResumeListKey>(key: K) => {
        const item = SECTION_CONFIG[key].create() as ItemOf<K>;
        onChange(prev => ({ ...prev, [key]: [...prev[key], item] }));
        setOpenIds(prev => new Set(prev).add(item.id));
        setJustAddedId(item.id);
    };

    const updateItem = <K extends ResumeListKey>(key: K, id: string, patch: Partial<ItemOf<K>>) => {
        const current = (resumeData[key] as ItemOf<K>[]).find(item => item.id === id);
        const pin = current ? pinBeforeEdit(current, patch) : null;
        if (pin) setDatePins(prev => (prev[id] ? prev : { ...prev, [id]: pin }));
        onChange(prev => ({
            ...prev,
            [key]: (prev[key] as ItemOf<K>[]).map(item => (item.id === id ? { ...item, ...patch } : item)),
        }));
    };

    // Removal only edits the draft; saved items are deleted by Save & Exit, so Discard brings them back.
    const removeItem = <K extends ResumeListKey>(key: K, id: string) => {
        settle(id);
        if (!isTempId(id)) onDeletePersisted(key, id);
        onChange(prev => ({ ...prev, [key]: (prev[key] as ItemOf<K>[]).filter(item => item.id !== id) }));
    };

    /** Copy placed right after the original (also in a manual order), opened for editing. */
    const duplicateItem = <K extends ResumeListKey>(key: K, id: string) => {
        const source = (resumeData[key] as ItemOf<K>[]).find(item => item.id === id);
        if (!source) return;
        const copy = { ...source, id: newTempId() } as ItemOf<K>;
        onChange(prev => {
            const list = prev[key] as ItemOf<K>[];
            const at = list.findIndex(item => item.id === id);
            const nextList = [...list.slice(0, at + 1), copy, ...list.slice(at + 1)];
            const order = prev.layout.itemOrder[key];
            const layout = order
                ? { ...prev.layout, itemOrder: { ...prev.layout.itemOrder, [key]: order.flatMap(x => (x === id ? [x, copy.id] : [x])) } }
                : prev.layout;
            return { ...prev, [key]: nextList, layout };
        });
        setOpenIds(prev => new Set(prev).add(copy.id));
        setJustAddedId(copy.id);
    };

    const sectionProps = { layout, advanced, collapsed: draggingSection, updateLayout };

    const renderSection = (id: SectionId, sortable: boolean) => {
        if (id === "summary") {
            return (
                <SortableSection key={id} id={id} sortable={sortable} icon={User} {...sectionProps}>
                    <SummaryField value={resumeData.personalInfo} onChange={updatePersonalInfo} autoFocus={initialOpenId === "summary"}
                        review={profileReview} reviewStale={profileReview ? isProfileReviewStale(resumeData.personalInfo, profileReview) : false} />
                </SortableSection>
            );
        }
        const key = id;
        const cfg = SECTION_CONFIG[key];
        const items = orderedItemsPinned(key, resumeData[key] as ItemOf<typeof key>[], layout, datePins);
        const ids = items.map(it => it.id);
        const manual = hasManualOrder(layout, key);
        return (
            <SortableSection
                key={key} id={key} sortable={sortable} icon={SECTION_ICON[key]} count={items.length} addLabel={cfg.addLabel} onAdd={() => addItem(key)}
                headerActions={manual && isDatedSection(key) && (
                    <Button size="sm" variant="ghost" icon={ArrowDownWideNarrow} onClick={() => updateLayout(l => resetItemOrder(l, key))} title="Newest first: current, then most recently ended">
                        Sort by date
                    </Button>
                )}
                {...sectionProps}
            >
                <SortableList
                    ids={ids}
                    labelOf={itemId => { const it = items.find(x => x.id === itemId); return it ? itemTitle(key, it) : "item"; }}
                    onMove={(activeId, overId) => updateLayout(l => moveItem(l, key, ids, activeId, overId))}
                >
                    {items.map(item => (
                        <SortableItemRow
                            key={item.id}
                            sectionKey={key}
                            item={item}
                            layout={layout}
                            advanced={advanced && ENTRY_SECTIONS.has(key)}
                            usedBy={variantUsage[item.id] ?? []}
                            review={reviews[item.id] ?? null}
                            open={openIds.has(item.id)}
                            onToggleOpen={() => toggleOpen(item.id)}
                            onSettle={() => settle(item.id)}
                            autoFocus={item.id === justAddedId}
                            onUpdate={patch => updateItem(key, item.id, patch)}
                            onRemove={() => removeItem(key, item.id)}
                            onDuplicate={() => duplicateItem(key, item.id)}
                            updateLayout={updateLayout}
                        />
                    ))}
                </SortableList>
            </SortableSection>
        );
    };

    const showProfile = tab === "all" || tab === "profile";

    return (
        <div className="space-y-8">
            {advanced && <PageLayoutCard layout={layout} onChange={updateLayout} />}
            {showProfile && (
                <PersonalInfoSection
                    value={resumeData.personalInfo} onChange={updatePersonalInfo} linkChecks={linkChecks}
                    links={resumeData.links ?? []} onLinksChange={links => onChange(prev => ({ ...prev, links }))}
                    focusField={initialOpenId?.startsWith("pi-") ? (initialOpenId.slice(3) as keyof ResumeData["personalInfo"]) : null}
                />
            )}
            {tab === "all" ? (
                <SortableList
                    ids={layout.sectionOrder}
                    labelOf={id => sectionTitle(id as SectionId)}
                    onDragStart={() => setDraggingSection(true)}
                    onDragDone={() => setDraggingSection(false)}
                    onMove={(activeId, overId) => updateLayout(l => moveSection(l, activeId as SectionId, overId as SectionId))}
                >
                    <div className="space-y-8">{layout.sectionOrder.map(id => renderSection(id, true))}</div>
                </SortableList>
            ) : (
                // A one-section tab has nothing to reorder against, but its rows still sit in a sortable context.
                <SortableList ids={[tab === "profile" ? "summary" : tab]} labelOf={id => sectionTitle(id as SectionId)} onMove={() => {}}>
                    {renderSection(tab === "profile" ? "summary" : tab, false)}
                </SortableList>
            )}
        </div>
    );
}

function SortableSection({ id, sortable, icon, count, addLabel, onAdd, headerActions, layout, advanced, collapsed, updateLayout, children }: {
    id: SectionId;
    sortable: boolean;
    icon: React.ComponentProps<typeof EditorSection>["icon"];
    count?: number;
    addLabel?: string;
    onAdd?: () => void;
    headerActions?: React.ReactNode;
    layout: ResumeLayout;
    advanced: boolean;
    collapsed: boolean;
    updateLayout: LayoutUpdate;
    children: React.ReactNode;
}) {
    const title = sectionTitle(id);
    const { rowRef, style, handle } = useSortableRow(id, title, !sortable);
    return (
        <EditorSection
            icon={icon} title={title} count={count} addLabel={addLabel} onAdd={onAdd}
            handle={handle} headerActions={headerActions} rowRef={rowRef} style={style}
            collapsed={collapsed} plain={id === "summary"}
            layoutControls={advanced && <SectionLayoutControls layout={layout} id={id} onChange={updateLayout} />}
        >
            {children}
        </EditorSection>
    );
}

function SortableItemRow<K extends ResumeListKey>({ sectionKey, item, layout, advanced, usedBy, review, open, onToggleOpen, onSettle, autoFocus, onUpdate, onRemove, onDuplicate, updateLayout }: {
    sectionKey: K;
    item: ItemOf<K>;
    layout: ResumeLayout;
    advanced: boolean;
    usedBy: string[];
    review: ItemReview | null;
    open: boolean;
    onToggleOpen: () => void;
    onSettle: () => void;
    autoFocus: boolean;
    onUpdate: (patch: Partial<ItemOf<K>>) => void;
    onRemove: () => void;
    onDuplicate: () => void;
    updateLayout: LayoutUpdate;
}) {
    const label = itemLabel(sectionKey, item);
    const errors = validateItemDates(sectionKey, item);
    const { rowRef, style, handle } = useSortableRow(item.id, itemTitle(sectionKey, item));
    // Dismissals are persisted, but `review` comes from server data: hide the row straight away.
    const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
    const suggestions = visibleSuggestions(sectionKey, item, review).filter(s => !dismissed.has(s.id));

    /** Accept edits the draft; Save & Exit persists it like any other edit. */
    const accept = (s: ReviewSuggestion) => {
        const patch = applySuggestionPatch(sectionKey, item, s);
        if (patch) onUpdate(patch);
    };
    const dismiss = (s: ReviewSuggestion) => {
        setDismissed(prev => new Set(prev).add(s.id));
        void dismissReviewSuggestion(sectionKey, item.id, s.id).catch(err => console.error("[editor] dismiss failed:", err));
    };

    return (
        <EditorItemRow
            id={item.id}
            title={label.title}
            subtitle={label.subtitle}
            meta={label.meta}
            isSelected={item.isSelected}
            onToggleSelected={checked => onUpdate({ isSelected: checked } as Partial<ItemOf<K>>)}
            onRemove={onRemove}
            onDuplicate={onDuplicate}
            usedBy={usedBy}
            review={review}
            reviewStale={isReviewStale(sectionKey, item, review)}
            stale={isStale(sectionKey, item)}
            words={itemWordCount(sectionKey, item)}
            dateError={errors.start ?? errors.end ?? errors.date}
            open={open}
            onToggleOpen={onToggleOpen}
            autoFocus={autoFocus}
            handle={handle}
            rowRef={rowRef}
            style={style}
        >
            {/* Focus leaving the row ends a date edit: the row then moves to its dated place. */}
            <div className="contents" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onSettle(); }}>
                {SECTION_CONFIG[sectionKey].fields(item, onUpdate, errors)}
            </div>
            <ReviewPanel
                review={review}
                suggestions={suggestions}
                stale={review ? isReviewStale(sectionKey, item, review) : false}
                fieldLabel={field => fieldSpec(sectionKey, field)?.label ?? field}
                onAccept={accept}
                onDismiss={dismiss}
            />
            {advanced && (
                <div className="space-y-2">
                    <p className="text-13 font-medium text-fg-muted">Layout for this item</p>
                    <ItemLayoutControls layout={layout} id={item.id} onChange={updateLayout} />
                </div>
            )}
        </EditorItemRow>
    );
}
