"use client";

import type { ProfileLink } from "@/lib/contact/links";
import { LinksEditor } from "@/components/ui/links-editor";
import React, { useRef, useState } from "react";
import Link from "next/link";
import type { PersonalInfo } from "@/types/schema";
import { Card, CardBody, CardHeader } from "@/components/ui/primitives/card";
import { Field, Input, Textarea } from "@/components/ui/primitives/field";
import { summaryWordCount, wordCaution } from "@/lib/text/word-count";
import { isContactField } from "@/lib/contact/normalize";
import type { LinkChecks } from "@/lib/contact/types";
import { ContactInput } from "@/components/ui/contact-field";
import type { ItemReview, ReviewSuggestion } from "@/lib/review/types";
import { fieldSpec } from "@/lib/review/content";
import { applyProfileSuggestion, visibleSuggestions } from "@/lib/review/apply";
import { ReviewPanel } from "@/components/ui/review/review-panel";
import { dismissReviewSuggestion } from "@/app/actions/review-actions";
import { PROFILE_ID } from "@/lib/tags/content";

export function PersonalInfoSection({ value, onChange, linkChecks, focusField, links, onLinksChange }: {
    value: PersonalInfo;
    /** Extra header links (ResumeData.links). */
    links: ProfileLink[];
    onLinksChange: (next: ProfileLink[]) => void;
    onChange: (field: keyof PersonalInfo, v: string) => void;
    linkChecks?: LinkChecks;
    /** Field to scroll to and focus on mount ("Fix email"). */
    focusField?: keyof PersonalInfo | null;
}) {
    // Ref callback (not an effect): focuses the linked field exactly once.
    const focused = useRef(false);
    const focusRef = (node: HTMLInputElement | null) => {
        if (!node || focused.current) return;
        focused.current = true;
        node.scrollIntoView({ block: "center", behavior: "smooth" });
        node.focus({ preventScroll: true });
    };
    const f = (field: keyof PersonalInfo, label: string, placeholder: string, extra?: React.ComponentProps<typeof Input>) => (
        isContactField(field) ? (
            <ContactInput {...(extra as object)} field={field} id={`pi-${field}`} label={label} value={value[field]} onChange={v => onChange(field, v)} placeholder={placeholder}
                linkChecks={linkChecks} inputRef={focusField === field ? focusRef : undefined} />
        ) : (
            <Field label={label} htmlFor={`pi-${field}`}>
                <Input id={`pi-${field}`} value={value[field]} onChange={e => onChange(field, e.target.value)} placeholder={placeholder} {...extra} />
            </Field>
        )
    );
    return (
        <Card>
            <CardHeader
                title="Personal information"
                hint={<>Also editable on your <Link href="/dashboard/profile" className="text-fg underline underline-offset-2">Profile</Link> page.</>}
            />
            <CardBody className="grid gap-4 md:grid-cols-2">
                {f("firstName", "First name", "Alex")}
                {f("lastName", "Last name", "Morgan")}
                <div className="md:col-span-2">{f("headline", "Headline", "B.S. Computer Science, Class of 2026 · Software · AI/ML")}</div>
                {f("email", "Professional email", "alex@example.com", { type: "email" })}
                {f("phone", "Phone", "(123) 456-7890", { type: "tel" })}
                {f("location", "Location", "Seattle, WA")}
                {f("website", "Website", "alexmorgan.dev")}
                {f("github", "GitHub", "github.com/alexmorgan")}
                {f("linkedin", "LinkedIn", "linkedin.com/in/alexmorgan")}
                <div className="md:col-span-2"><LinksEditor value={links} onChange={onLinksChange} idPrefix="pi-links" checks={linkChecks} /></div>
            </CardBody>
        </Card>
    );
}

/** The professional summary: its own (movable) résumé section in the editor. */
export function SummaryField({ value, onChange, autoFocus, review = null, reviewStale = false }: {
    value: PersonalInfo;
    onChange: (field: keyof PersonalInfo, v: string) => void;
    autoFocus?: boolean;
    /** Coach review of the saved headline + summary; accepting edits the draft. */
    review?: ItemReview | null;
    reviewStale?: boolean;
}) {
    // Ref callback (not an effect): an Action items link scrolls here exactly once.
    const focused = useRef(false);
    const focusRef = (node: HTMLTextAreaElement | null) => {
        if (!node || !autoFocus || focused.current) return;
        focused.current = true;
        node.scrollIntoView({ block: "center", behavior: "smooth" });
        node.focus({ preventScroll: true });
    };
    // Dismissals are persisted, but `review` comes from server data: hide the row straight away.
    const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
    const suggestions = visibleSuggestions("profile", value, review).filter(s => !dismissed.has(s.id));

    /** Accept edits the draft; Save & Exit persists it like any other edit. */
    const accept = (s: ReviewSuggestion) => {
        const patch = applyProfileSuggestion(value, s);
        if (!patch) return;
        for (const [field, v] of Object.entries(patch)) onChange(field as keyof PersonalInfo, v);
    };
    const dismiss = (s: ReviewSuggestion) => {
        setDismissed(prev => new Set(prev).add(s.id));
        void dismissReviewSuggestion("profile", PROFILE_ID, s.id).catch(err => console.error("[editor] dismiss failed:", err));
    };

    return (
        <Card>
            <CardBody className="pt-4">
                <Field label="Professional summary" htmlFor="pi-summary" {...wordCaution(summaryWordCount(value), "your summary")}>
                    <Textarea ref={focusRef} id="pi-summary" value={value.summary} onChange={e => onChange("summary", e.target.value)} placeholder="Brief overview of your professional background and goals…" rows={4} />
                </Field>
                <ReviewPanel
                    className="mt-4"
                    review={review}
                    suggestions={suggestions}
                    stale={reviewStale}
                    fieldLabel={field => fieldSpec("profile", field)?.label ?? field}
                    onAccept={accept}
                    onDismiss={dismiss}
                />
            </CardBody>
        </Card>
    );
}
