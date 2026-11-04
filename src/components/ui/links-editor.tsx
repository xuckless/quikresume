// src/components/ui/links-editor.tsx
"use client";

// Extra header links (portfolio, ORCID, Behance, Google Scholar...), shared by the Editor's personal
// information card and the Profile page. URLs are normalised on blur like the website field.

import React from "react";
import { MAX_LINK_LABEL, MAX_LINK_URL, MAX_LINKS, type ProfileLink } from "@/lib/contact/links";
import { normalizeWebsite } from "@/lib/contact/normalize";
import { brokenExtraLink, type LinkChecks } from "@/lib/contact/types";
import { Button, IconButton, Input, Label } from "@/components/ui/primitives";
import { Plus, Trash2 } from "@/components/ui/primitives/icons";

export function LinksEditor({ value, onChange, idPrefix = "links", checks }: { value: ProfileLink[]; onChange: (next: ProfileLink[]) => void; idPrefix?: string; checks?: LinkChecks }) {
    const set = (i: number, patch: Partial<ProfileLink>) => onChange(value.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
                <Label>Other links</Label>
                <span className="text-xs text-fg-subtle">Portfolio, ORCID, Behance, Google Scholar… printed in the header</span>
            </div>
            {value.map((l, i) => {
                const issue = l.url.trim() ? normalizeWebsite(l.url).message ?? (brokenExtraLink(checks, l.url) ? "We couldn't find this page. Check the address." : undefined) : undefined;
                return (
                    <div key={i} className="grid grid-cols-[minmax(0,0.6fr)_minmax(0,1.4fr)_auto] items-start gap-2">
                        <Input id={`${idPrefix}-label-${i}`} aria-label={`Link ${i + 1} label`} placeholder="Portfolio" maxLength={MAX_LINK_LABEL}
                            value={l.label} onChange={e => set(i, { label: e.target.value })} />
                        <div>
                            <Input id={`${idPrefix}-url-${i}`} aria-label={`Link ${i + 1} address`} placeholder="behance.net/alexmorgan" maxLength={MAX_LINK_URL} inputMode="url"
                                value={l.url} onChange={e => set(i, { url: e.target.value })}
                                onBlur={() => { const r = normalizeWebsite(l.url); if (r.level === "ok" && r.value !== l.url) set(i, { url: r.value }); }} />
                            {issue && <p className="mt-1 text-xs text-warning">{issue}</p>}
                        </div>
                        <IconButton icon={Trash2} aria-label={`Remove link ${i + 1}`} onClick={() => onChange(value.filter((_, j) => j !== i))} />
                    </div>
                );
            })}
            {value.length < MAX_LINKS && (
                <Button size="sm" variant="ghost" onClick={() => onChange([...value, { label: "", url: "" }])}><Plus className="size-3.5" aria-hidden /> Add link</Button>
            )}
        </div>
    );
}
