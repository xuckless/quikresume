"use client";

import React, { startTransition, useOptimistic, useState } from "react";
import type { ResumeData, ResumeListKey } from "@/types/schema";
import { RESUME_LIST_KEYS } from "@/types/schema";
import { isBriefOutdated, isReviewStale } from "@/lib/review/content";
import type { ItemReview } from "@/lib/review/types";
import type {
    AwardItem, CertificationItem, EducationItem, ExperienceItem, LanguageItem, ProjectItem, PublicationItem,
    SkillCategoryItem, VolunteeringItem, CustomItem,
} from "@/types/db";
import { deleteExperience, updateExperience } from "@/app/actions/experience-actions";
import { deleteEducation, updateEducation } from "@/app/actions/education-actions";
import { deleteSkill, updateSkill } from "@/app/actions/skill-actions";
import { deleteProject, updateProject } from "@/app/actions/project-actions";
import { deleteCertification, updateCertification } from "@/app/actions/certification-actions";
import { deleteAward, updateAward } from "@/app/actions/award-actions";
import { deleteVolunteering, updateVolunteering } from "@/app/actions/volunteering-actions";
import { deletePublication, updatePublication } from "@/app/actions/publication-actions";
import { deleteLanguage, updateLanguage } from "@/app/actions/language-actions";
import { deleteCustomEntry, updateCustomEntry } from "@/app/actions/custom-actions";
import { formatDateRange, formatMonthYear, PRESENT } from "@/lib/dates";
import { SECTION_LABEL } from "@/lib/sections";
import type { SectionTab } from "@/components/ui/section-tabs";
import { LibrarySection } from "./library-section";
import { Detail, LibraryRow, SubItemToggles } from "./library-row";
import { bulletEntries, bulletLines, skillEntries, visible } from "@/lib/sub-items";
import { EmptyState } from "@/components/ui/primitives/empty-state";
import { SortableList, useSortableRow } from "@/components/ui/primitives/sortable";
import { updateLayout } from "@/app/actions/layout-actions";
import { setSectionSelection } from "@/app/actions/library-actions";
import { hasManualOrder, isDatedSection, moveItem, moveSection, orderedItems, resetItemOrder } from "@/lib/layout/order";
import type { ResumeLayout, SectionId } from "@/lib/layout/types";
import { Button } from "@/components/ui/primitives/button";
import {
    ArrowDownWideNarrow, Award, BadgeCheck, BookOpen, Briefcase, FolderGit2, GraduationCap, HeartHandshake, Languages, Layers, Library, Search, Wrench,
    type LucideIcon,
} from "@/components/ui/primitives/icons";

export const SECTION_ICON: Record<ResumeListKey, LucideIcon> = {
    workExperience: Briefcase,
    education: GraduationCap,
    projects: FolderGit2,
    skills: Wrench,
    volunteering: HeartHandshake,
    publications: BookOpen,
    awards: Award,
    certifications: BadgeCheck,
    languages: Languages,
    custom: Layers,
};

export interface LibraryLists {
    experiences: ExperienceItem[];
    educations: EducationItem[];
    skills: SkillCategoryItem[];
    projects: ProjectItem[];
    certifications: CertificationItem[];
    awards: AwardItem[];
    volunteering: VolunteeringItem[];
    publications: PublicationItem[];
    languages: LanguageItem[];
    custom: CustomItem[];
}

export function libraryCounts(lists: LibraryLists): Record<ResumeListKey, number> {
    return {
        workExperience: lists.experiences.length,
        education: lists.educations.length,
        projects: lists.projects.length,
        skills: lists.skills.length,
        volunteering: lists.volunteering.length,
        publications: lists.publications.length,
        awards: lists.awards.length,
        certifications: lists.certifications.length,
        languages: lists.languages.length,
        custom: lists.custom.length,
    };
}

interface LibraryViewProps extends LibraryLists {
    tab: SectionTab;
    variantUsage: Record<string, string[]>;
    /** Editor model of the same library: item dates for ordering, and the saved layout. */
    resumeData: ResumeData;
    onImport: () => void;
    onEdit: (tab?: SectionTab) => void;
    /** Search text: filters rows by title, subtitle and tags (drag is off while searching). */
    query: string;
    onError: (message: string) => void;
    /** Current "About you" brief hash (reviews written against another one are marked). */
    briefHash: string | null;
    /** A re-review finished with new results: refresh server data. */
    onReviewed: () => void;
}

export function LibraryView({ tab, variantUsage, resumeData, onImport, onEdit, query, onError, briefHash, onReviewed, ...lists }: LibraryViewProps) {
    const counts = libraryCounts(lists);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    // Dragging saves straight away; the optimistic layout shows the new order until revalidation lands.
    const [layout, setOptimisticLayout] = useOptimistic(resumeData.layout);
    const [draggingSection, setDraggingSection] = useState(false);

    if (total === 0) {
        return (
            <EmptyState
                icon={Library}
                title="Your library is empty"
                body="Import an existing résumé to fill it in seconds, or add items by hand in the editor."
                actions={
                    <>
                        <Button variant="primary" onClick={onImport}>Import résumé</Button>
                        <Button onClick={() => onEdit()}>Open editor</Button>
                    </>
                }
            />
        );
    }

    const saveLayout = (next: ResumeLayout) => {
        startTransition(async () => {
            setOptimisticLayout(next);
            try {
                await updateLayout(next);
            } catch (err) {
                console.error("[library] layout save failed:", err);
                onError("Couldn't save the new order. Try again.");
            }
        });
    };

    const q = query.trim().toLowerCase();
    const searching = q !== "";
    const matches = (row: { title: string; subtitle?: string; tags?: { display: string }[] }) =>
        !searching || row.title.toLowerCase().includes(q) || (row.subtitle ?? "").toLowerCase().includes(q) || (row.tags ?? []).some(t => t.display.toLowerCase().includes(q));

    if (tab !== "all" && tab !== "profile" && counts[tab] === 0) {
        return (
            <EmptyState
                icon={SECTION_ICON[tab]}
                title={`No ${SECTION_LABEL[tab].toLowerCase()} yet`}
                body="Add items in the editor, or import them from an existing résumé."
                actions={
                    <>
                        <Button variant="primary" onClick={() => onEdit(tab)}>Add in editor</Button>
                        <Button onClick={onImport}>Import résumé</Button>
                    </>
                }
            />
        );
    }

    const show = (key: ResumeListKey) => (tab === "all" || tab === key) && counts[key] > 0;
    const range = (start: string | null, end: string | null | undefined, isActive: boolean) => formatDateRange(start, isActive ? PRESENT : end);

    /** Rows in print order: the editor model decides the order, the Firestore rows render. */
    const ordered = <T extends { id: string; tags: { display: string }[] }>(key: ResumeListKey, rows: T[], text: (r: T) => { title: string; subtitle?: string }): T[] => {
        const byId = new Map(rows.map(r => [r.id, r]));
        return orderedItems(key, resumeData[key] as ResumeData[ResumeListKey][number][], layout)
            .map(it => byId.get(it.id))
            .filter((r): r is T => r !== undefined && matches({ ...text(r), tags: r.tags }));
    };
    const modelById = new Map(RESUME_LIST_KEYS.flatMap(key => (resumeData[key] as ResumeData[ResumeListKey][number][]).map(it => [it.id, it] as const)));
    const rowProps = (key: ResumeListKey, row: { id: string; review: ItemReview | null }) => {
        const item = modelById.get(row.id);
        return {
            onError,
            sortable: !searching,
            coach: item ? {
                target: key,
                item,
                review: row.review,
                stale: isReviewStale(key, item, row.review),
                briefOutdated: isBriefOutdated(row.review, briefHash),
                onReviewed: onReviewed,
            } : undefined,
        };
    };

    const renderRows: Record<ResumeListKey, () => { ids: string[]; labels: Record<string, string>; rows: React.ReactNode }> = {
        workExperience: () => {
            const xs = ordered("workExperience", lists.experiences, x => ({ title: x.position, subtitle: x.company }));
            return {
                ids: xs.map(x => x.id), labels: Object.fromEntries(xs.map(x => [x.id, x.position])),
                rows: xs.map(x => (
                    <SortableLibraryRow key={x.id} {...rowProps("workExperience", x)} id={x.id} title={x.position} subtitle={x.company} meta={range(x.startDate, x.endDate, x.isActive)}
                        isSelected={x.isSelected} active={{ isActive: x.isActive, type: "experience" }} tags={x.tags} usedBy={variantUsage[x.id]}
                        onUpdate={updateExperience} onDelete={deleteExperience}>
                        <SubItemToggles id={x.id} entries={bulletEntries(bulletLines(x.description))} hidden={x.hidden} onError={onError} onUpdate={updateExperience} variant="bullets" />
                    </SortableLibraryRow>
                )),
            };
        },
        education: () => {
            const xs = ordered("education", lists.educations, x => ({ title: x.programName, subtitle: x.schoolName }));
            return {
                ids: xs.map(x => x.id), labels: Object.fromEntries(xs.map(x => [x.id, x.programName])),
                rows: xs.map(x => (
                    <SortableLibraryRow key={x.id} {...rowProps("education", x)} id={x.id} title={x.programName} subtitle={x.schoolName} meta={range(x.startDate, x.endDate, x.isActive)}
                        isSelected={x.isSelected} active={{ isActive: x.isActive, type: "education" }} tags={x.tags} usedBy={variantUsage[x.id]}
                        onUpdate={updateEducation} onDelete={deleteEducation}>
                        <div className="flex flex-wrap gap-1.5">
                            <Detail label="GPA" value={x.gpa} />
                            <Detail label="Minor" value={x.minorName} />
                            <Detail label="Location" value={[x.locationCity, x.locationProvince].filter(Boolean).join(", ")} />
                        </div>
                        {x.details && <p className="text-fg-muted leading-relaxed">{x.details}</p>}
                    </SortableLibraryRow>
                )),
            };
        },
        projects: () => {
            const xs = ordered("projects", lists.projects, x => ({ title: x.title, subtitle: x.stack ?? "" }));
            return {
                ids: xs.map(x => x.id), labels: Object.fromEntries(xs.map(x => [x.id, x.title])),
                rows: xs.map(x => (
                    <SortableLibraryRow key={x.id} {...rowProps("projects", x)} id={x.id} title={x.title} subtitle={x.stack ?? ""} meta={range(x.startDate, x.endDate, x.isActive)}
                        isSelected={x.isSelected} active={{ isActive: x.isActive, type: "project" }} tags={x.tags} usedBy={variantUsage[x.id]}
                        onUpdate={updateProject} onDelete={deleteProject}>
                        {x.link && <p className="break-all text-fg-muted">{x.link}</p>}
                        <SubItemToggles id={x.id} entries={bulletEntries(bulletLines(x.description))} hidden={x.hidden} onError={onError} onUpdate={updateProject} variant="bullets" />
                    </SortableLibraryRow>
                )),
            };
        },
        skills: () => {
            const xs = ordered("skills", lists.skills, x => ({ title: x.category, subtitle: x.items }));
            return {
                ids: xs.map(x => x.id), labels: Object.fromEntries(xs.map(x => [x.id, x.category])),
                rows: xs.map(x => (
                    <SortableLibraryRow key={x.id} {...rowProps("skills", x)} id={x.id} title={x.category} subtitle={visible(skillEntries(x.items), x.hidden).map(e => e.label).join(", ")}
                        isSelected={x.isSelected} tags={x.tags} usedBy={variantUsage[x.id]}
                        onUpdate={updateSkill} onDelete={deleteSkill}>
                        <SubItemToggles id={x.id} entries={skillEntries(x.items)} hidden={x.hidden} onError={onError} onUpdate={updateSkill} variant="chips" />
                    </SortableLibraryRow>
                )),
            };
        },
        volunteering: () => {
            const xs = ordered("volunteering", lists.volunteering, x => ({ title: x.role, subtitle: x.organization }));
            return {
                ids: xs.map(x => x.id), labels: Object.fromEntries(xs.map(x => [x.id, x.role])),
                rows: xs.map(x => (
                    <SortableLibraryRow key={x.id} {...rowProps("volunteering", x)} id={x.id} title={x.role} subtitle={x.organization} meta={range(x.startDate, x.endDate, x.isActive)}
                        isSelected={x.isSelected} active={{ isActive: x.isActive, type: "volunteering" }} tags={x.tags} usedBy={variantUsage[x.id]}
                        onUpdate={updateVolunteering} onDelete={deleteVolunteering}>
                        <SubItemToggles id={x.id} entries={bulletEntries(bulletLines(x.description))} hidden={x.hidden} onError={onError} onUpdate={updateVolunteering} variant="bullets" />
                    </SortableLibraryRow>
                )),
            };
        },
        custom: () => {
            const sub = (x: CustomItem) => [x.subtitle, x.section].filter(Boolean).join(" · ");
            const xs = ordered("custom", lists.custom, x => ({ title: x.title, subtitle: sub(x) }));
            return {
                ids: xs.map(x => x.id), labels: Object.fromEntries(xs.map(x => [x.id, x.title])),
                rows: xs.map(x => (
                    <SortableLibraryRow key={x.id} {...rowProps("custom", x)} id={x.id} title={x.title} subtitle={sub(x)} meta={range(x.startDate, x.endDate, x.isActive)}
                        isSelected={x.isSelected} active={{ isActive: x.isActive, type: "custom" }} tags={x.tags} usedBy={variantUsage[x.id]}
                        onUpdate={updateCustomEntry} onDelete={deleteCustomEntry}>
                        <SubItemToggles id={x.id} entries={bulletEntries(bulletLines(x.description))} hidden={x.hidden} onError={onError} onUpdate={updateCustomEntry} variant="bullets" />
                    </SortableLibraryRow>
                )),
            };
        },
        publications: () => {
            const xs = ordered("publications", lists.publications, x => ({ title: x.title, subtitle: [x.authors, x.venue].filter(Boolean).join(" · ") }));
            return {
                ids: xs.map(x => x.id), labels: Object.fromEntries(xs.map(x => [x.id, x.title])),
                rows: xs.map(x => (
                    <SortableLibraryRow key={x.id} {...rowProps("publications", x)} id={x.id} title={x.title} subtitle={[x.authors, x.venue].filter(Boolean).join(" · ")} meta={formatMonthYear(x.date)}
                        isSelected={x.isSelected} tags={x.tags} usedBy={variantUsage[x.id]} onUpdate={updatePublication} onDelete={deletePublication}>
                        {x.authors && <p className="text-fg-muted">{x.authors}</p>}
                        {x.venue && <p className="text-fg-muted">{x.venue}</p>}
                        {x.link && <p className="break-all text-fg-muted">{x.link}</p>}
                    </SortableLibraryRow>
                )),
            };
        },
        awards: () => {
            const xs = ordered("awards", lists.awards, x => ({ title: x.title, subtitle: x.issuer ?? "" }));
            return {
                ids: xs.map(x => x.id), labels: Object.fromEntries(xs.map(x => [x.id, x.title])),
                rows: xs.map(x => (
                    <SortableLibraryRow key={x.id} {...rowProps("awards", x)} id={x.id} title={x.title} subtitle={x.issuer ?? ""} meta={formatMonthYear(x.date)}
                        isSelected={x.isSelected} tags={x.tags} usedBy={variantUsage[x.id]} onUpdate={updateAward} onDelete={deleteAward}>
                        {x.description && <p className="text-fg-muted leading-relaxed">{x.description}</p>}
                    </SortableLibraryRow>
                )),
            };
        },
        certifications: () => {
            const xs = ordered("certifications", lists.certifications, x => ({ title: x.name, subtitle: x.issuer ?? "" }));
            return {
                ids: xs.map(x => x.id), labels: Object.fromEntries(xs.map(x => [x.id, x.name])),
                rows: xs.map(x => (
                    <SortableLibraryRow key={x.id} {...rowProps("certifications", x)} id={x.id} title={x.name} subtitle={x.issuer ?? ""} meta={x.year}
                        isSelected={x.isSelected} tags={x.tags} usedBy={variantUsage[x.id]} onUpdate={updateCertification} onDelete={deleteCertification} />
                )),
            };
        },
        languages: () => {
            const xs = ordered("languages", lists.languages, x => ({ title: x.language, subtitle: x.proficiency ?? "" }));
            return {
                ids: xs.map(x => x.id), labels: Object.fromEntries(xs.map(x => [x.id, x.language])),
                rows: xs.map(x => (
                    <SortableLibraryRow key={x.id} {...rowProps("languages", x)} id={x.id} title={x.language} subtitle={x.proficiency ?? ""}
                        isSelected={x.isSelected} tags={x.tags} usedBy={variantUsage[x.id]} onUpdate={updateLanguage} onDelete={deleteLanguage} />
                )),
            };
        },
    };

    const section = (key: ResumeListKey, sortable: boolean, ids: string[], labels: Record<string, string>, rows: React.ReactNode) => {
        const items = resumeData[key] as { isSelected: boolean }[];
        return (
            <SortableLibrarySection
                key={key} sectionKey={key} sortable={sortable && !searching} ids={ids} collapsed={draggingSection}
                sortByDate={!searching && hasManualOrder(layout, key) && isDatedSection(key) ? () => saveLayout(resetItemOrder(layout, key)) : undefined}
                allSelected={items.every(it => it.isSelected)} noneSelected={items.every(it => !it.isSelected)} onError={onError}
            >
                <SortableList ids={ids} labelOf={id => labels[id] || "item"} onMove={(activeId, overId) => saveLayout(moveItem(layout, key, ids, activeId, overId))}>
                    {rows}
                </SortableList>
            </SortableLibrarySection>
        );
    };

    // The summary has no library section; it keeps its place in the order. While searching, sections without a match hide.
    const rendered = layout.sectionOrder
        .filter((id): id is ResumeListKey => id !== "summary" && show(id))
        .map(key => ({ key, ...renderRows[key]() }))
        .filter(r => !searching || r.ids.length > 0);
    const visibleKeys = rendered.map(r => r.key);

    if (searching && rendered.length === 0) {
        return <EmptyState icon={Search} title={`No items match "${query.trim()}"`} body="Search looks at titles, companies, skills and tags." />;
    }

    if (tab !== "all" || searching) {
        return (
            <div className="space-y-8">
                {rendered.map(r => (
                    <SortableList key={r.key} ids={[r.key]} labelOf={() => SECTION_LABEL[r.key]} onMove={() => {}}>{section(r.key, false, r.ids, r.labels, r.rows)}</SortableList>
                ))}
            </div>
        );
    }
    return (
        <SortableList
            ids={visibleKeys}
            labelOf={id => SECTION_LABEL[id as ResumeListKey]}
            onDragStart={() => setDraggingSection(true)}
            onDragDone={() => setDraggingSection(false)}
            onMove={(activeId, overId) => saveLayout(moveSection(layout, activeId as SectionId, overId as SectionId))}
        >
            <div className="space-y-8">{rendered.map(r => section(r.key, true, r.ids, r.labels, r.rows))}</div>
        </SortableList>
    );
}

function SortableLibrarySection({ sectionKey, sortable, ids, collapsed, sortByDate, allSelected, noneSelected, onError, children }: {
    sectionKey: ResumeListKey;
    sortable: boolean;
    ids: string[];
    collapsed: boolean;
    sortByDate?: () => void;
    allSelected: boolean;
    noneSelected: boolean;
    onError: (message: string) => void;
    children: React.ReactNode;
}) {
    const title = SECTION_LABEL[sectionKey];
    const { rowRef, style, handle } = useSortableRow(sectionKey, title, !sortable);
    const [pending, setPending] = useState<"include" | "exclude" | null>(null);
    const setAll = async (on: boolean) => {
        setPending(on ? "include" : "exclude");
        try {
            await setSectionSelection(sectionKey, on);
        } catch (err) {
            console.error("[library] bulk selection failed:", err);
            onError(`Couldn't ${on ? "include" : "exclude"} every item in ${title}. Try again.`);
        } finally {
            setPending(null);
        }
    };
    return (
        <LibrarySection
            icon={SECTION_ICON[sectionKey]} title={title} ids={ids} handle={handle} rowRef={rowRef} style={style} collapsed={collapsed}
            headerActions={
                <>
                    {sortByDate && <Button size="sm" variant="ghost" icon={ArrowDownWideNarrow} onClick={sortByDate}>Sort by date</Button>}
                    {!allSelected && <Button size="sm" variant="ghost" onClick={() => void setAll(true)} loading={pending === "include"} disabled={pending !== null} className="hidden sm:inline-flex">Include all</Button>}
                    {!noneSelected && <Button size="sm" variant="ghost" onClick={() => void setAll(false)} loading={pending === "exclude"} disabled={pending !== null} className="hidden sm:inline-flex">Exclude all</Button>}
                </>
            }
        >
            {children}
        </LibrarySection>
    );
}

function SortableLibraryRow({ sortable, ...props }: React.ComponentProps<typeof LibraryRow> & { sortable: boolean }) {
    const { rowRef, style, handle } = useSortableRow(props.id, props.title || "item", !sortable);
    return <LibraryRow {...props} handle={handle} rowRef={rowRef} style={style} />;
}
