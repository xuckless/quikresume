// src/components/ui/profile-form.tsx
"use client";

import type { ProfileLink } from "@/lib/contact/links";
import { LinksEditor } from "@/components/ui/links-editor";
import React, { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type { PersonalInfo } from "@/types/schema";
import { updateProfileFields, updateUserProfile } from "@/app/actions/user-actions";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/primitives/button";
import { Field, Input, Textarea } from "@/components/ui/primitives/field";
import { summaryWordCount, wordCaution } from "@/lib/text/word-count";
import { Card, CardBody, CardHeader } from "@/components/ui/primitives/card";
import { NoticeBanner } from "@/components/ui/primitives/notice-banner";
import { ContactInput } from "@/components/ui/contact-field";
import { contactBlocking, isContactField } from "@/lib/contact/normalize";
import type { LinkChecks } from "@/lib/contact/types";
import { kickLinkCheck } from "@/lib/ui/link-check";
import { useOperation } from "@/lib/ui/use-operation";
import type { ItemReview, ReviewSuggestion } from "@/lib/review/types";
import { applyProfileSuggestion, visibleSuggestions } from "@/lib/review/apply";
import { fieldSpec, isProfileReviewStale } from "@/lib/review/content";
import { kickReviews, useReviewRunState } from "@/lib/ui/review-runner";
import { dismissReviewSuggestion } from "@/app/actions/review-actions";
import { ReviewPanel } from "@/components/ui/review/review-panel";
import { PROFILE_ID } from "@/lib/tags/content";

interface ProfileFormProps {
    initial: PersonalInfo;
    initialLinks: ProfileLink[];
    account: { name: string; email: string; image: string | null };
    linkChecks: LinkChecks;
    review: ItemReview | null;
}


export function ProfileForm({ initial, initialLinks, account, linkChecks, review }: ProfileFormProps) {
    const router = useRouter();
    const runState = useReviewRunState();
    const [handled, setHandled] = useState<ReadonlySet<string>>(new Set());
    // Local draft seeded once from the server value; never re-synced from props.
    const [info, setInfo] = useState<PersonalInfo>(initial);
    const [links, setLinks] = useState<ProfileLink[]>(initialLinks);
    const save = useOperation<"save", Extract<Awaited<ReturnType<typeof updateUserProfile>>, { success: true }>>();
    const apply = useOperation<"apply">();
    const status = save.running ? "saving" : save.state.status === "succeeded" ? "saved" : save.error ? "error" : "idle";
    const error = save.error ?? apply.error;

    const setValue = (field: keyof PersonalInfo, value: string) => {
        setInfo(prev => ({ ...prev, [field]: value }));
        if (status === "saved") save.reset();
    };
    const set = (field: keyof PersonalInfo) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValue(field, e.target.value);

    const blocking = contactBlocking(info);

    const handleSave = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (blocking) return;
        const done = await save.run("save", async () => {
            const result = await updateUserProfile(info, links);
            if (!result.success) throw new Error(result.error);
            return result;
        }, "Failed to save your profile.");
        if (!done?.ok) return;
        const result = done.result;
        const extraChanged = JSON.stringify((result.links ?? links).map(l => l.url)) !== JSON.stringify(initialLinks.map(l => l.url));
        const linksChanged = extraChanged || (["github", "linkedin", "website"] as const).some(k => result.info[k] !== initial[k]) || Object.keys(linkChecks).length === 0;
        // Edits made while saving win over the server's normalised copy.
        setInfo(current => current === info ? result.info : current);
        if (result.links) { const savedLinks = result.links; setLinks(current => current === links ? savedLinks : current); }
        if (linksChanged) kickLinkCheck(() => router.refresh());
        if (result.info.headline !== initial.headline || result.info.summary !== initial.summary) {
            kickReviews({ ids: [PROFILE_ID], onDone: r => { if (r.reviewed > 0) router.refresh(); } });
        }
    };

    const dirty = JSON.stringify(info) !== JSON.stringify(initial) || JSON.stringify(links) !== JSON.stringify(initialLinks);

    // Coach suggestions apply to the saved headline / summary; accepting one saves it straight away.
    const savedText = { ...info, headline: initial.headline, summary: initial.summary };
    const suggestions = visibleSuggestions("profile", savedText, review).filter(s => !handled.has(s.id));
    const acceptSuggestion = async (s: ReviewSuggestion) => {
        const patch = applyProfileSuggestion(savedText, s);
        if (!patch || apply.running) return;
        setHandled(prev => new Set(prev).add(s.id));
        const done = await apply.run("apply", () => updateProfileFields(patch), "Couldn't apply the suggestion.");
        if (done?.ok) {
            setInfo(prev => ({ ...prev, ...patch }));
            router.refresh();
        } else if (done) {
            // Show it again so it can be retried.
            setHandled(prev => { const next = new Set(prev); next.delete(s.id); return next; });
        }
    };
    const dismissSuggestion = async (s: ReviewSuggestion) => {
        setHandled(prev => new Set(prev).add(s.id));
        try { await dismissReviewSuggestion("profile", PROFILE_ID, s.id); } catch { /* stays hidden locally */ }
    };

    const f = (field: keyof PersonalInfo, label: string, placeholder: string, extra?: React.ComponentProps<typeof Input>, className?: string) => (
        isContactField(field) ? (
            <ContactInput {...(extra as object)} field={field} id={`profile-${field}`} label={label} value={info[field]} onChange={v => setValue(field, v)} placeholder={placeholder} linkChecks={linkChecks} className={className} />
        ) : (
            <Field label={label} htmlFor={`profile-${field}`} className={className}>
                <Input id={`profile-${field}`} value={info[field]} onChange={set(field)} placeholder={placeholder} {...extra} />
            </Field>
        )
    );

    return (
        <div className="grid items-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
            <Card as="aside">
                <CardBody className="space-y-4 pt-4">
                    <div className="flex items-center gap-3">
                        {account.image ? (
                            <Image src={account.image} alt="" width={40} height={40} className="size-10 rounded-full" />
                        ) : (
                            <div className="size-10 rounded-full bg-surface-muted" />
                        )}
                        <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-fg">{account.name || "Google account"}</p>
                            <p className="truncate text-13 text-fg-muted">{account.email}</p>
                        </div>
                    </div>
                    <p className="text-13 text-fg-muted">
                        Signed in with Google. Your sign-in email stays private; the professional email on the right is the one printed on your résumé.
                    </p>
                </CardBody>
            </Card>

            <Card>
                <form onSubmit={handleSave} noValidate>
                <CardHeader title="Résumé header" hint="These fields appear at the top of every résumé you generate." />
                <CardBody className="space-y-4">
                    {error && <NoticeBanner tone="danger" onDismiss={() => { save.reset(); apply.reset(); }}>{error}</NoticeBanner>}
                    <div className="grid gap-4 md:grid-cols-2">
                        {f("firstName", "First name", "Alex", { autoComplete: "given-name" })}
                        {f("lastName", "Last name", "Morgan", { autoComplete: "family-name" })}
                        {f("headline", "Headline", "B.S. Computer Science, Class of 2026 · Software · AI/ML", undefined, "md:col-span-2")}
                        {f("email", "Professional email", "alex@example.com", { type: "email", autoComplete: "email" })}
                        {f("phone", "Phone", "(123) 456-7890", { type: "tel", autoComplete: "tel" })}
                        {f("location", "Location", "Seattle, WA")}
                        {f("website", "Website", "alexmorgan.dev", { inputMode: "url" })}
                        <div className="md:col-span-2"><LinksEditor value={links} onChange={next => { setLinks(next); if (status === "saved") save.reset(); }} idPrefix="profile-links" checks={linkChecks} /></div>
                        {f("github", "GitHub", "github.com/alexmorgan")}
                        {f("linkedin", "LinkedIn", "linkedin.com/in/alexmorgan")}
                        <Field label="Professional summary" htmlFor="profile-summary" className="md:col-span-2" {...wordCaution(summaryWordCount(info), "your summary")}>
                            <Textarea id="profile-summary" value={info.summary} onChange={set("summary")} placeholder="Brief overview of your professional background and goals…" rows={4} />
                        </Field>
                        <ReviewPanel
                            className="md:col-span-2"
                            review={review}
                            suggestions={dirty ? [] : suggestions}
                            stale={review ? isProfileReviewStale(initial, review) : false}
                            running={runState.running && runState.ids.includes(PROFILE_ID)}
                            fieldLabel={field => fieldSpec("profile", field)?.label ?? field}
                            onAccept={s => void acceptSuggestion(s)}
                            onDismiss={s => void dismissSuggestion(s)}
                            onReReview={() => kickReviews({ ids: [PROFILE_ID], onDone: r => { if (r.reviewed > 0) router.refresh(); } })}
                        />
                    </div>
                    <div className="flex flex-col-reverse gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-end">
                        <span className={cn("text-13", status === "saved" ? "text-success" : "text-fg-subtle")} aria-live="polite">
                            {status === "saved" ? "Saved" : dirty ? "Unsaved changes" : ""}
                        </span>
                        <Button type="submit" variant="primary" loading={status === "saving"} disabled={Boolean(blocking) || (!dirty && status !== "error")} title={blocking ? blocking.message : undefined}>
                            Save profile
                        </Button>
                    </div>
                </CardBody>
                </form>
            </Card>
        </div>
    );
}
