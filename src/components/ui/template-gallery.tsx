// src/components/ui/template-gallery.tsx
"use client";

// Template picker: a compact Select for the preview toolbar and a gallery dialog that renders every
// template with the user's own résumé (first page), plus accent, font pair and paper size. Changes
// go through `onChange`; the dashboard decides where they land (editor draft or the saved layout).

import React, { useEffect, useReducer } from "react";
import type { ResumeData } from "@/types/schema";
import { ACCENTS, FONT_PAIRS, PAPERS, type AccentId, type FontPairId, type PaperId, type ResumeTheme } from "@/lib/layout/theme";
import { TEMPLATES, type TemplateId } from "@/lib/typst/templates";
import { toTypstDoc, type TypstResumeDoc } from "@/lib/typst/doc";
import { compileSvg, ensureTypst } from "@/lib/typst/client";
import { svgLayout } from "@/lib/typst/pages";
import { cn } from "@/lib/cn";
import { Button, FOCUS_RING } from "@/components/ui/primitives/button";
import { Field, Select } from "@/components/ui/primitives/field";
import { Dialog } from "@/components/ui/primitives/dialog";
import { Segmented } from "@/components/ui/primitives/segmented";
import { Check, Loader2 } from "@/components/ui/primitives/icons";

const TEMPLATE_IDS = Object.keys(TEMPLATES) as TemplateId[];

export function TemplateSelect({ theme, onChange, className }: { theme: ResumeTheme; onChange: (t: ResumeTheme) => void; className?: string }) {
    return (
        <Select
            value={theme.templateId}
            onChange={e => onChange({ ...theme, templateId: e.target.value as TemplateId })}
            aria-label="Template"
            className={className}
            selectClassName="h-8 text-13"
        >
            {TEMPLATE_IDS.map(id => <option key={id} value={id}>{TEMPLATES[id].label}</option>)}
        </Select>
    );
}

export function TemplateGalleryDialog({ open, onClose, resumeData, theme, onChange }: {
    open: boolean;
    onClose: () => void;
    resumeData: ResumeData;
    theme: ResumeTheme;
    onChange: (t: ResumeTheme) => void;
}) {
    return (
        <Dialog open={open} onClose={onClose} title="Templates" description="Every template rendered with your own résumé. Accent and fonts apply to whichever template you pick." size="lg"
            footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
            <div className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Accent">
                        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Accent colour">
                            {(Object.keys(ACCENTS) as AccentId[]).map(id => {
                                const a = ACCENTS[id];
                                const on = theme.accent === id;
                                return (
                                    <button
                                        key={id}
                                        type="button"
                                        role="radio"
                                        aria-checked={on}
                                        title={a.label}
                                        aria-label={a.label}
                                        onClick={() => onChange({ ...theme, accent: id })}
                                        className={cn("flex size-7 items-center justify-center rounded-full border", on ? "border-fg" : "border-border", FOCUS_RING)}
                                        style={a.hex ? { background: a.hex } : undefined}
                                    >
                                        {!a.hex && <span className="text-[10px] font-medium text-fg-muted">Aa</span>}
                                        {on && a.hex && <Check className="size-3.5 text-white" aria-hidden />}
                                    </button>
                                );
                            })}
                        </div>
                    </Field>
                    <Field label="Fonts" htmlFor="theme-font">
                        <Select id="theme-font" value={theme.font} onChange={e => onChange({ ...theme, font: e.target.value as FontPairId })}>
                            {(Object.keys(FONT_PAIRS) as FontPairId[]).map(id => <option key={id} value={id}>{FONT_PAIRS[id].label}</option>)}
                        </Select>
                    </Field>
                    <Field label="Paper">
                        <Segmented<PaperId>
                            value={theme.paper}
                            onChange={paper => onChange({ ...theme, paper })}
                            options={(Object.keys(PAPERS) as PaperId[]).map(id => ({ value: id, label: PAPERS[id] }))}
                        />
                    </Field>
                </div>
                {open && <Thumbnails resumeData={resumeData} theme={theme} onPick={templateId => onChange({ ...theme, templateId })} />}
            </div>
        </Dialog>
    );
}

type ThumbnailsState = { status: "loading" | "ready" | "failed"; svgs: Partial<Record<TemplateId, string>> };
type ThumbnailsEvent = { type: "start" | "complete" | "fail" } | { type: "render"; id: TemplateId; svg: string };
function thumbnailsTransition(state: ThumbnailsState, event: ThumbnailsEvent): ThumbnailsState {
    switch (event.type) {
        case "start": return { status: "loading", svgs: {} };
        case "complete": return { ...state, status: "ready" };
        case "fail": return { ...state, status: "failed" };
        case "render": return { ...state, svgs: { ...state.svgs, [event.id]: event.svg } };
    }
}

/** First page of each template, compiled one after another through the shared Typst queue. */
function Thumbnails({ resumeData, theme, onPick }: { resumeData: ResumeData; theme: ResumeTheme; onPick: (id: TemplateId) => void }) {
    const docJson = JSON.stringify(toTypstDoc({ ...resumeData, layout: { ...resumeData.layout, theme } }));
    const [state, dispatch] = useReducer(thumbnailsTransition, { status: "loading", svgs: {} });
    const { svgs } = state;
    const failed = state.status === "failed";

    useEffect(() => {
        let cancelled = false;
        const timer = setTimeout(async () => {
            dispatch({ type: "start" });
            try {
                await ensureTypst();
                if (cancelled) return;
                const doc = JSON.parse(docJson) as TypstResumeDoc;
                for (const id of TEMPLATE_IDS) {
                    const { svg } = await compileSvg(doc, id);
                    if (cancelled) return;
                    dispatch({ type: "render", id, svg });
                }
                dispatch({ type: "complete" });
            } catch {
                if (!cancelled) dispatch({ type: "fail" });
            }
        }, 200);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [docJson]);

    return (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4" role="radiogroup" aria-label="Template">
            {TEMPLATE_IDS.map(id => {
                const on = theme.templateId === id;
                const svg = svgs[id];
                const page = svg ? svgLayout(svg, 1)?.pages[0] : undefined;
                const total = svg ? svgLayout(svg, 1)?.height : undefined;
                return (
                    <button
                        key={id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => onPick(id)}
                        className={cn("group space-y-2 rounded-lg p-1.5 text-left transition-colors hover:bg-surface-hover", on && "bg-surface-muted", FOCUS_RING)}
                    >
                        <div
                            className={cn("relative overflow-hidden rounded-sm border bg-paper shadow-sm", on ? "border-accent ring-2 ring-accent/30" : "border-border")}
                            style={{ aspectRatio: page ? `${page.width} / ${page.height}` : "210 / 297" }}
                        >
                            {svg && page && total ? (
                                <div
                                    aria-hidden
                                    className="absolute inset-x-0 top-0 [&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
                                    style={{ transform: `translateY(-${(page.y / total) * 100}%)` }}
                                    dangerouslySetInnerHTML={{ __html: svg }}
                                />
                            ) : (
                                <span className="absolute inset-0 flex items-center justify-center text-xs text-fg-subtle">
                                    {failed ? "Preview unavailable" : <Loader2 className="size-4 animate-spin" aria-label="Rendering" />}
                                </span>
                            )}
                        </div>
                        <span className="block px-0.5">
                            <span className="flex items-center gap-1 text-13 font-medium text-fg">{TEMPLATES[id].label}{on && <Check className="size-3.5 text-accent" aria-hidden />}</span>
                            <span className="block text-xs text-fg-muted">{TEMPLATES[id].blurb}</span>
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
