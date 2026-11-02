// src/components/ui/autofill/autofill-form.tsx
"use client";

// Autofill preferences form (meta/autofill). Saved as a whole with saveAutofillPrefs.

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { saveAutofillPrefs } from "@/app/actions/autofill-actions";
import { EEO_OPTIONS, LIMITS_AUTOFILL, type AutofillEeo, type AutofillPrefs, type YesNo } from "@/lib/autofill/types";
import { Button, Card, CardBody, CardHeader, Field, Input, NoticeBanner, Select, Textarea } from "@/components/ui/primitives";
import { Segmented } from "@/components/ui/primitives/segmented";

const EEO_LABEL: Record<keyof AutofillEeo, string> = {
    gender: "Gender", pronouns: "Pronouns", ethnicity: "Race / ethnicity", veteran: "Veteran status", disability: "Disability", lgbtq: "LGBTQ+",
};

function YesNoField({ label, value, onChange, hint }: { label: string; value: YesNo; onChange: (v: YesNo) => void; hint?: string }) {
    return (
        <Field label={label} hint={hint}>
            <Segmented<YesNo> value={value} onChange={onChange} options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "", label: "Ask me" }]} />
        </Field>
    );
}

export function AutofillForm({ initial }: { initial: AutofillPrefs }) {
    const router = useRouter();
    const [p, setP] = useState(initial);
    const [saving, setSaving] = useState(false);
    const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
    const set = <K extends keyof AutofillPrefs>(k: K, v: AutofillPrefs[K]) => setP(prev => ({ ...prev, [k]: v }));
    const addr = (k: keyof AutofillPrefs["address"], v: string) => setP(prev => ({ ...prev, address: { ...prev.address, [k]: v } }));
    const sal = (k: keyof AutofillPrefs["salary"], v: string) => setP(prev => ({ ...prev, salary: { ...prev.salary, [k]: v } as AutofillPrefs["salary"] }));
    const eeo = (k: keyof AutofillEeo, v: string) => setP(prev => ({ ...prev, eeo: { ...prev.eeo, [k]: v } }));

    const save = async () => {
        setSaving(true);
        setNotice(null);
        try {
            const res = await saveAutofillPrefs(p);
            if (res.ok) { setP(res.prefs); setNotice({ tone: "success", text: "Saved." }); router.refresh(); }
            else setNotice({ tone: "danger", text: res.error });
        } catch (err) {
            setNotice({ tone: "danger", text: err instanceof Error ? err.message : "Could not save." });
        } finally {
            setSaving(false);
        }
    };

    const answerFor = (question: string) => {
        const id = `a${Date.now().toString(36)}`;
        setP(prev => ({ ...prev, answers: [...prev.answers, { id, question, answer: "" }].slice(0, LIMITS_AUTOFILL.answers), unmapped: prev.unmapped.filter(u => u.label !== question) }));
    };

    return (
        <div className="space-y-4">
            {notice && <NoticeBanner tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</NoticeBanner>}

            {p.unmapped.length > 0 && (
                <Card>
                    <CardHeader title="Fields the extension couldn't fill" hint="Add an answer once and Auto Fill uses it next time." />
                    <CardBody>
                        <ul className="divide-y divide-border">
                            {p.unmapped.slice().reverse().map(u => (
                                <li key={`${u.label}|${u.host}`} className="flex items-center justify-between gap-3 py-2 text-13">
                                    <span className="min-w-0"><span className="text-fg">{u.label}</span><span className="block text-xs text-fg-subtle">{u.host}</span></span>
                                    <span className="flex shrink-0 gap-1">
                                        <Button size="sm" onClick={() => answerFor(u.label)}>Add answer</Button>
                                        <Button size="sm" variant="ghost" onClick={() => set("unmapped", p.unmapped.filter(x => x !== u))}>Ignore</Button>
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </CardBody>
                </Card>
            )}

            <Card>
                <CardHeader title="Address" hint="Your profile location stays the short form on the résumé; forms often want the full address." />
                <CardBody className="grid gap-3 @container sm:grid-cols-2">
                    <Field label="Street" htmlFor="af-street" className="sm:col-span-2"><Input id="af-street" autoComplete="address-line1" value={p.address.street} onChange={e => addr("street", e.target.value)} /></Field>
                    <Field label="Apartment, suite" htmlFor="af-street2" className="sm:col-span-2"><Input id="af-street2" autoComplete="address-line2" value={p.address.street2} onChange={e => addr("street2", e.target.value)} /></Field>
                    <Field label="City" htmlFor="af-city"><Input id="af-city" autoComplete="address-level2" value={p.address.city} onChange={e => addr("city", e.target.value)} /></Field>
                    <Field label="State / province" htmlFor="af-region"><Input id="af-region" autoComplete="address-level1" value={p.address.region} onChange={e => addr("region", e.target.value)} /></Field>
                    <Field label="Postal code" htmlFor="af-postal"><Input id="af-postal" autoComplete="postal-code" value={p.address.postalCode} onChange={e => addr("postalCode", e.target.value)} /></Field>
                    <Field label="Country" htmlFor="af-country"><Input id="af-country" autoComplete="country-name" value={p.address.country} onChange={e => addr("country", e.target.value)} /></Field>
                </CardBody>
            </Card>

            <Card>
                <CardHeader title="Work eligibility" hint="Prefilled from About you when empty. “Ask me” leaves the question for you." />
                <CardBody className="grid gap-4 sm:grid-cols-3">
                    <YesNoField label="Authorised to work" value={p.workAuthorized} onChange={v => set("workAuthorized", v)} />
                    <YesNoField label="Needs sponsorship" value={p.needsSponsorship} onChange={v => set("needsSponsorship", v)} />
                    <YesNoField label="Willing to relocate" value={p.willingToRelocate} onChange={v => set("willingToRelocate", v)} />
                </CardBody>
            </Card>

            <Card>
                <CardHeader title="Pay and availability" />
                <CardBody className="grid gap-3 sm:grid-cols-4">
                    <Field label="Minimum" htmlFor="af-min"><Input id="af-min" inputMode="numeric" value={p.salary.min} onChange={e => sal("min", e.target.value)} placeholder="80000" /></Field>
                    <Field label="Target" htmlFor="af-target"><Input id="af-target" inputMode="numeric" value={p.salary.target} onChange={e => sal("target", e.target.value)} placeholder="95000" /></Field>
                    <Field label="Currency" htmlFor="af-cur"><Input id="af-cur" maxLength={3} value={p.salary.currency} onChange={e => sal("currency", e.target.value.toUpperCase())} /></Field>
                    <Field label="Per" htmlFor="af-per">
                        <Select id="af-per" value={p.salary.period} onChange={e => sal("period", e.target.value)}>
                            <option value="year">Year</option><option value="month">Month</option><option value="hour">Hour</option>
                        </Select>
                    </Field>
                    <Field label="Notice period" htmlFor="af-notice" className="sm:col-span-2"><Input id="af-notice" value={p.noticePeriod} onChange={e => set("noticePeriod", e.target.value)} placeholder="2 weeks" /></Field>
                    <Field label="Earliest start" htmlFor="af-start" className="sm:col-span-2"><Input id="af-start" type="date" value={p.earliestStart} onChange={e => set("earliestStart", e.target.value)} /></Field>
                    <Field label="How did you hear about us (default)" htmlFor="af-hear" className="sm:col-span-4"><Input id="af-hear" value={p.howDidYouHear} onChange={e => set("howDidYouHear", e.target.value)} placeholder="Company website" /></Field>
                </CardBody>
            </Card>

            <Card>
                <CardHeader title="Voluntary self-identification" hint="US employers ask these; answers never affect your application. Default is “Decline to answer”." />
                <CardBody className="grid gap-3 sm:grid-cols-2">
                    {(Object.keys(EEO_LABEL) as (keyof AutofillEeo)[]).map(k => (
                        <Field key={k} label={EEO_LABEL[k]} htmlFor={`af-eeo-${k}`}>
                            <Select id={`af-eeo-${k}`} value={p.eeo[k]} onChange={e => eeo(k, e.target.value)}>
                                {EEO_OPTIONS[k].map(o => <option key={o} value={o}>{o}</option>)}
                            </Select>
                        </Field>
                    ))}
                </CardBody>
            </Card>

            <Card>
                <CardHeader title="Instructions for AI answers" hint="How the AI should write answers to open questions like “What makes you a fit for this role?”" />
                <CardBody>
                    <Textarea
                        rows={5}
                        maxLength={LIMITS_AUTOFILL.instructions}
                        value={p.agentInstructions}
                        onChange={e => set("agentInstructions", e.target.value)}
                        placeholder="Lead with my patient-safety work and the EHR migration. Keep answers under 120 words, first person, no buzzwords. Never mention salary."
                    />
                    <p className="mt-1 text-right text-xs text-fg-subtle tabular-nums">{p.agentInstructions.length}/{LIMITS_AUTOFILL.instructions}</p>
                </CardBody>
            </Card>

            <Card>
                <CardHeader
                    title="Saved answers"
                    hint="Used word for word when a form asks the same question."
                    action={<Button size="sm" onClick={() => answerFor("")} disabled={p.answers.length >= LIMITS_AUTOFILL.answers}>Add</Button>}
                />
                <CardBody className="space-y-3">
                    {p.answers.length === 0 && <p className="text-13 text-fg-muted">None yet.</p>}
                    {p.answers.map((a, i) => (
                        <div key={a.id} className="space-y-2 rounded-md border border-border p-3">
                            <Input aria-label="Question" placeholder="Question" value={a.question} onChange={e => set("answers", p.answers.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))} />
                            <Textarea aria-label="Answer" placeholder="Answer" rows={3} value={a.answer} onChange={e => set("answers", p.answers.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))} />
                            <div className="text-right"><Button size="sm" variant="ghost" onClick={() => set("answers", p.answers.filter((_, j) => j !== i))}>Remove</Button></div>
                        </div>
                    ))}
                </CardBody>
            </Card>

            <div className="sticky bottom-4 flex justify-end">
                <Button variant="primary" onClick={save} loading={saving}>Save preferences</Button>
            </div>
        </div>
    );
}
