"use client";

// Per-section editor configuration: how to create a blank item and which
// fields to render for it. The container (resume-form.tsx) stays generic.

import React from "react";
import type {
    Award, Certification, Education, Language, Project, Publication, ResumeData, ResumeListKey, SkillCategory,
    Volunteering, WorkExperience,
} from "@/types/schema";
import { newTempId } from "@/lib/ids";
import { toBullets } from "@/lib/typst/doc";
import { bulletEntries, skillEntries, toggleHidden, type SubItem } from "@/lib/sub-items";
import { SubItemList } from "@/components/ui/sub-item-toggles";
import { Field, Input, Textarea } from "@/components/ui/primitives/field";
import { MonthField } from "@/components/ui/primitives/month-field";
import type { DateErrors } from "@/lib/validation/dates";
import { DateRangeFields } from "./date-range-fields";

type ItemOf<K extends ResumeListKey> = ResumeData[K][number];
type Patch<K extends ResumeListKey> = (patch: Partial<ItemOf<K>>) => void;

export interface SectionConfig<K extends ResumeListKey> {
    addLabel: string;
    create: () => ItemOf<K>;
    fields: (item: ItemOf<K>, set: Patch<K>, errors: DateErrors) => React.ReactNode;
}

const base = () => ({ id: newTempId(), isSelected: true, tags: [], tagsHash: null });
const fid = (itemId: string, field: string) => `${itemId}-${field}`;

function Text<K extends ResumeListKey>({ item, set, field, label, placeholder, type, className, error }: { item: ItemOf<K>; set: Patch<K>; field: keyof ItemOf<K> & string; label: string; placeholder?: string; type?: string; className?: string; error?: string }) {
    return (
        <Field label={label} htmlFor={fid(item.id, field)} className={className} error={error}>
            <Input id={fid(item.id, field)} type={type} value={item[field] as string} onChange={e => set({ [field]: e.target.value } as Partial<ItemOf<K>>)} placeholder={placeholder} />
        </Field>
    );
}

function Month<K extends ResumeListKey>({ item, set, field, label, className, error }: { item: ItemOf<K>; set: Patch<K>; field: keyof ItemOf<K> & string; label: string; className?: string; error?: string }) {
    return (
        <Field label={label} htmlFor={fid(item.id, field)} className={className} error={error}>
            <MonthField id={fid(item.id, field)} value={item[field] as string} invalid={Boolean(error)} onChange={v => set({ [field]: v } as Partial<ItemOf<K>>)} />
        </Field>
    );
}

function Lines<K extends ResumeListKey>({ item, set, field, label, placeholder, rows = 4 }: { item: ItemOf<K>; set: Patch<K>; field: keyof ItemOf<K> & string; label: string; placeholder?: string; rows?: number }) {
    return (
        <Field label={label} htmlFor={fid(item.id, field)}>
            <Textarea id={fid(item.id, field)} value={item[field] as string} onChange={e => set({ [field]: e.target.value } as Partial<ItemOf<K>>)} placeholder={placeholder} rows={rows} />
        </Field>
    );
}

/** "Shown on résumé" switches for the bullets / skills parsed live from the draft text. */
function ShownOnResume({ id, entries, hidden, onChange, variant }: { id: string; entries: SubItem[]; hidden: string[]; onChange: (hidden: string[]) => void; variant: "bullets" | "chips" }) {
    // A single bullet is covered by the item's own switch.
    if (entries.length < (variant === "bullets" ? 2 : 1)) return null;
    return (
        <div className="space-y-2 rounded-md border border-border bg-surface-muted/50 p-3">
            <p className="text-13 font-medium text-fg-muted">Shown on résumé</p>
            <SubItemList idPrefix={`ed-${id}`} entries={entries} hidden={hidden} onToggle={key => onChange(toggleHidden(hidden, key))} variant={variant} className="text-13" />
        </div>
    );
}

type WithBullets = WorkExperience | Project | Volunteering;
const bulletToggles = <T extends WithBullets>(x: T, set: (patch: Partial<T>) => void) => (
    <ShownOnResume id={x.id} entries={bulletEntries(toBullets(x.description))} hidden={x.hidden ?? []} onChange={hidden => set({ hidden } as Partial<T>)} variant="bullets" />
);

const two = "grid gap-4 md:grid-cols-2";

export const SECTION_CONFIG: { [K in ResumeListKey]: SectionConfig<K> } = {
    workExperience: {
        addLabel: "Add role",
        create: (): WorkExperience => ({ ...base(), hidden: [], title: "", company: "", startDate: "", endDate: "", description: "" }),
        fields: (x, set, errors) => (
            <>
                <div className={two}>
                    <Text item={x} set={set} field="title" label="Position" placeholder="Senior Software Engineer" />
                    <Text item={x} set={set} field="company" label="Company" placeholder="Tech Corp" />
                </div>
                <DateRangeFields idPrefix={x.id} startDate={x.startDate} endDate={x.endDate} currentLabel="I work here now" errors={errors} onChange={set} />
                <Lines item={x} set={set} field="description" label="Responsibilities (one per line)" placeholder="Key achievements, one per line…" />
                {bulletToggles(x, set)}
            </>
        ),
    },
    education: {
        addLabel: "Add education",
        create: (): Education => ({ ...base(), degree: "", institution: "", startDate: "", endDate: "", gpa: "", minor: "", details: "" }),
        fields: (x, set, errors) => (
            <>
                <div className={two}>
                    <Text item={x} set={set} field="degree" label="Degree / program" placeholder="B.S. in Computer Science" />
                    <Text item={x} set={set} field="institution" label="Institution" placeholder="State University" />
                </div>
                <DateRangeFields idPrefix={x.id} startDate={x.startDate} endDate={x.endDate} currentLabel="Currently enrolled" errors={errors} onChange={set} />
                <div className={two}>
                    <Text item={x} set={set} field="gpa" label="GPA (optional)" placeholder="3.8 / 4.0" />
                    <Text item={x} set={set} field="minor" label="Minor (optional)" placeholder="Statistics" />
                </div>
                <Lines item={x} set={set} field="details" label="Honors / coursework (optional)" placeholder="Dean's List. Coursework: Distributed Systems, Machine Learning…" rows={2} />
            </>
        ),
    },
    skills: {
        addLabel: "Add category",
        create: (): SkillCategory => ({ ...base(), hidden: [], category: "", items: "" }),
        fields: (x, set) => (
            <>
                <div className="grid gap-4 md:grid-cols-[1fr_2fr]">
                    <Text item={x} set={set} field="category" label="Category" placeholder="Languages" />
                    <Text item={x} set={set} field="items" label="Skills (comma separated)" placeholder="Python, Java, TypeScript, Go, SQL" />
                </div>
                <ShownOnResume id={x.id} entries={skillEntries(x.items)} hidden={x.hidden ?? []} onChange={hidden => set({ hidden })} variant="chips" />
            </>
        ),
    },
    projects: {
        addLabel: "Add project",
        create: (): Project => ({ ...base(), hidden: [], title: "", stack: "", link: "", startDate: "", endDate: "", description: "" }),
        fields: (x, set, errors) => (
            <>
                <div className={two}>
                    <Text item={x} set={set} field="title" label="Title" placeholder="Support Ticket Classifier" />
                    <Text item={x} set={set} field="link" label="Link (optional)" placeholder="github.com/you/project" />
                </div>
                <Text item={x} set={set} field="stack" label="Tech stack" placeholder="PyTorch, FastAPI, Docker, AWS Lambda" />
                <DateRangeFields idPrefix={x.id} startDate={x.startDate} endDate={x.endDate} currentLabel="Ongoing" errors={errors} onChange={set} />
                <Lines item={x} set={set} field="description" label="Highlights (one per line)" placeholder="What you built, with a number. Impact or scale." />
                {bulletToggles(x, set)}
            </>
        ),
    },
    certifications: {
        addLabel: "Add certification or licence",
        create: (): Certification => ({ ...base(), name: "", issuer: "", year: "", credentialId: "", expires: "" }),
        fields: (x, set, errors) => (
            <div className="grid gap-4 md:grid-cols-3">
                <Text item={x} set={set} field="name" label="Name" placeholder="Registered Nurse · AWS Certified Cloud Practitioner" className="md:col-span-2" />
                <Text item={x} set={set} field="year" label="Year obtained (optional)" placeholder="2025" error={errors.date} />
                <Text item={x} set={set} field="issuer" label="Issuer or licensing body (optional)" placeholder="College of Nurses of Ontario" className="md:col-span-3" />
                <Text item={x} set={set} field="credentialId" label="Licence / credential number (optional, printed)" placeholder="RN 1234567" className="md:col-span-2" />
                <Text item={x} set={set} field="expires" label="Expires (optional)" placeholder="2027-05" error={errors.expires} />
            </div>
        ),
    },
    volunteering: {
        addLabel: "Add activity",
        create: (): Volunteering => ({ ...base(), hidden: [], role: "", organization: "", startDate: "", endDate: "", description: "" }),
        fields: (x, set, errors) => (
            <>
                <div className={two}>
                    <Text item={x} set={set} field="role" label="Role" placeholder="Coding Mentor" />
                    <Text item={x} set={set} field="organization" label="Organization" placeholder="Girls Who Code" />
                </div>
                <DateRangeFields idPrefix={x.id} startDate={x.startDate} endDate={x.endDate} currentLabel="Still involved" errors={errors} onChange={set} />
                <Lines item={x} set={set} field="description" label="Highlights (one per line)" placeholder="What you did and the impact, one per line…" rows={3} />
                {bulletToggles(x, set)}
            </>
        ),
    },
    publications: {
        addLabel: "Add publication",
        create: (): Publication => ({ ...base(), title: "", venue: "", date: "", link: "", authors: "" }),
        fields: (x, set, errors) => (
            <>
                <Text item={x} set={set} field="title" label="Title" placeholder="Efficient Tracing at Scale" />
                <div className="grid gap-4 md:grid-cols-3">
                    <Text item={x} set={set} field="venue" label="Venue / publisher" placeholder="USENIX ATC" className="md:col-span-2" />
                    <Month item={x} set={set} field="date" label="Date (optional)" error={errors.date} />
                </div>
                <div className={two}>
                    <Text item={x} set={set} field="authors" label="Authors (optional)" placeholder="A. Morgan, J. Doe" />
                    <Text item={x} set={set} field="link" label="Link (optional)" placeholder="doi.org/10.1000/xyz" />
                </div>
            </>
        ),
    },
    awards: {
        addLabel: "Add award",
        create: (): Award => ({ ...base(), title: "", issuer: "", date: "", description: "" }),
        fields: (x, set, errors) => (
            <>
                <div className="grid gap-4 md:grid-cols-3">
                    <Text item={x} set={set} field="title" label="Title" placeholder="Dean's List" className="md:col-span-2" />
                    <Month item={x} set={set} field="date" label="Date (optional)" error={errors.date} />
                    <Text item={x} set={set} field="issuer" label="Issuer (optional)" placeholder="State University" className="md:col-span-3" />
                </div>
                <Lines item={x} set={set} field="description" label="Description (optional)" placeholder="Top 5% of the class, 3 semesters running." rows={2} />
            </>
        ),
    },
    languages: {
        addLabel: "Add language",
        create: (): Language => ({ ...base(), language: "", proficiency: "" }),
        fields: (x, set) => (
            <div className={two}>
                <Text item={x} set={set} field="language" label="Language" placeholder="French" />
                <Text item={x} set={set} field="proficiency" label="Proficiency (optional)" placeholder="Native / Fluent / B2" />
            </div>
        ),
    },
};
