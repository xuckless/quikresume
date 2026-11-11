// src/components/ui/resume-preview.tsx
"use client";

import React, { useEffect, useReducer, useState } from "react";
import { useOperation } from "@/lib/ui/use-operation";
import type { ResumeData } from "@/types/schema";
import { pdfFileName, toTypstDoc, type TypstResumeDoc } from "@/lib/typst/doc";
import { compilePdf, compileSvg, ensureTypst, formatTypstError, isEngineError } from "@/lib/typst/client";
import { DEFAULT_TEMPLATE, type TemplateId } from "@/lib/typst/templates";
import { svgLayout } from "@/lib/typst/pages";
import { INITIAL_PREVIEW, previewImage, previewTransition } from "@/lib/typst/preview-state";
import { cn } from "@/lib/cn";
import { Button, IconButton } from "@/components/ui/primitives/button";
import { Badge } from "@/components/ui/primitives/badge";
import { Download, Palette, RefreshCw, X } from "@/components/ui/primitives/icons";
import { TemplateGalleryDialog, TemplateSelect } from "@/components/ui/template-gallery";
import type { ResumeTheme } from "@/lib/layout/theme";

interface ResumePreviewProps {
    resumeData: ResumeData;
    /** Overrides the template on the résumé's layout (gallery / comparisons). */
    template?: TemplateId;
    /** Pane mode: tighter toolbar with a close button. */
    compact?: boolean;
    onClose?: () => void;
    /** Hide the download button (the tailor window downloads through its own flow). */
    hideDownload?: boolean;
    /** Shows the template picker; called with the new theme (the caller persists it). */
    onThemeChange?: (theme: ResumeTheme) => void;
}

type Status = "loading-engine" | "compiling" | "ready" | "error" | "engine-failed";


const DEBOUNCE_MS = 300;

export function ResumePreview({ resumeData, template: templateOverride, compact = false, onClose, hideDownload = false, onThemeChange }: ResumePreviewProps) {
    const [galleryOpen, setGalleryOpen] = useState(false);
    // Key the effect on the serialized document so object identity churn never
    // triggers a recompile; only real content changes do.
    const docJson = JSON.stringify(toTypstDoc(resumeData));
    const template: TemplateId = templateOverride ?? resumeData.layout?.theme?.templateId ?? DEFAULT_TEMPLATE;

    const [preview, dispatch] = useReducer(previewTransition, INITIAL_PREVIEW);
    const status = preview.status;
    const image = previewImage(preview);
    const svg = image?.svg ?? null;
    const pageCount = image?.pageCount ?? 0;
    const error = "error" in preview ? preview.error : null;
    const download = useOperation<"pdf">();
    const downloading = download.running !== null;
    const downloadError = download.error;
    // Bumped by the Retry button after an engine failure: the loader re-arms itself, the effect re-runs.
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let cancelled = false;
        const timer = setTimeout(async () => {
            const doc = JSON.parse(docJson) as TypstResumeDoc;
            try {
                dispatch({ type: "load" });
                await ensureTypst();
                if (cancelled) return;
                dispatch({ type: "compile" });
                const result = await compileSvg(doc, template);
                if (cancelled) return;
                dispatch({ type: "render", image: result });
            } catch (err) {
                if (cancelled) return;
                dispatch({ type: "fail", error: formatTypstError(err), engine: isEngineError(err) });
            }
        }, DEBOUNCE_MS);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [docJson, template, attempt]);

    const handleDownload = () => download.run("pdf", async () => {
        try {
            const bytes = await compilePdf(JSON.parse(docJson) as TypstResumeDoc, template);
            const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
            const a = document.createElement("a");
            a.href = url;
            a.download = pdfFileName(resumeData.personalInfo);
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (err) {
            throw new Error(formatTypstError(err));
        }
    });

    const statusLabel: Record<Status, string> = {
        "loading-engine": "Loading engine…",
        compiling: "Compiling…",
        ready: "Up to date",
        error: "Compile error",
        "engine-failed": "Engine unavailable",
    };
    const failed = status === "error" || status === "engine-failed";

    return (
        <div className={cn("flex flex-col", compact ? "h-full" : "gap-4")}>
            <div className={cn("flex items-center gap-2", compact ? "h-12 shrink-0 border-b border-border px-3" : "flex-wrap")}>
                {compact && <span className="text-13 font-medium">Preview</span>}
                <span className={cn("text-xs", failed ? "text-danger" : "text-fg-subtle", status !== "ready" && !failed && "animate-pulse")}>{statusLabel[status]}</span>
                {pageCount > 0 && <Badge tone={pageCount > 1 ? "warning" : "neutral"}>{pageCount} {pageCount === 1 ? "page" : "pages"}</Badge>}
                <div className="ml-auto flex items-center gap-1">
                    {onThemeChange && (
                        <>
                            <TemplateSelect theme={resumeData.layout.theme} onChange={onThemeChange} className={compact ? "w-28" : "w-36"} />
                            <Button size="sm" variant="ghost" icon={Palette} onClick={() => setGalleryOpen(true)} aria-label="Templates and style">
                                {compact ? null : "Style"}
                            </Button>
                        </>
                    )}
                    {status === "engine-failed" && (
                        <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => setAttempt(a => a + 1)}>Retry</Button>
                    )}
                    {!hideDownload && (
                        <Button size="sm" variant={compact ? "secondary" : "primary"} icon={Download} onClick={() => void handleDownload()} loading={downloading} disabled={status === "loading-engine" || status === "engine-failed"}>
                            {downloading ? "Preparing…" : compact ? "PDF" : "Download PDF"}
                        </Button>
                    )}
                    {compact && onClose && <IconButton icon={X} aria-label="Close preview" onClick={onClose} />}
                </div>
            </div>

            {onThemeChange && (
                <TemplateGalleryDialog open={galleryOpen} onClose={() => setGalleryOpen(false)} resumeData={resumeData} theme={resumeData.layout.theme} onChange={onThemeChange} />
            )}
            <div className={cn(compact && "min-h-0 flex-1 overflow-y-auto p-4")}>
                {downloadError && <ErrorPanel title="PDF export failed" message={downloadError} />}
                {status === "engine-failed" && error && (
                    <ErrorPanel
                        title="The preview engine could not load"
                        message={error}
                        hint="Nothing in your résumé is filtered or rejected by the preview: every word you write is typeset as-is. This failure is about loading the engine itself. Use Retry, or reload the page."
                    />
                )}
                {status === "error" && error && (
                    <ErrorPanel
                        title="Typst compile error"
                        message={error}
                        hint="The engine loaded but this document did not compile. Your text is passed through unchanged, so this usually points at the template; the message above names the file and line."
                    />
                )}
                <div className={cn("mx-auto w-full overflow-hidden", compact ? "" : "max-w-[210mm]")}>
                    {svg ? (
                        <PageSheets svg={svg} pageCount={pageCount} dimmed={status === "compiling" || status === "error"} />
                    ) : (
                        <div className="flex aspect-[210/297] w-full items-center justify-center border border-border bg-paper">
                            <span className="text-13 text-fg-subtle">{failed ? "Nothing rendered yet" : statusLabel[status]}</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

/**
 * One white sheet per page with a gap between them. Each sheet is a window onto the same SVG: the
 * box has the page's aspect ratio and the SVG inside is shifted up by the page's offset. Falls back
 * to the single tall SVG when the page boxes can't be read.
 */
function PageSheets({ svg, pageCount, dimmed }: { svg: string; pageCount: number; dimmed: boolean }) {
    const layout = svgLayout(svg, pageCount);
    const sheet = "border border-border bg-paper shadow-sm [&_svg]:block [&_svg]:h-auto [&_svg]:w-full";
    if (!layout || layout.pages.length <= 1) {
        return <div className={cn(sheet, "transition-opacity", dimmed ? "opacity-60" : "opacity-100")} dangerouslySetInnerHTML={{ __html: svg }} />;
    }
    return (
        <div className={cn("space-y-4 transition-opacity", dimmed ? "opacity-60" : "opacity-100")}>
            {layout.pages.map((p, i) => (
                <div key={i} className="relative">
                    <div className={cn(sheet, "relative overflow-hidden")} style={{ aspectRatio: `${p.width} / ${p.height}` }}>
                        <div
                            aria-hidden={i > 0 || undefined}
                            className="absolute inset-x-0 top-0"
                            // Shift by the page's top as a share of the whole document height (translateY % is of the element itself).
                            style={{ transform: `translateY(-${(p.y / layout.height) * 100}%)` }}
                            dangerouslySetInnerHTML={{ __html: svg }}
                        />
                    </div>
                    <span className="absolute -bottom-3.5 right-0 font-mono text-[11px] tabular-nums text-fg-subtle">{i + 1} / {layout.pages.length}</span>
                </div>
            ))}
        </div>
    );
}

function ErrorPanel({ title, message, hint }: { title: string; message: string; hint?: string }) {
    return (
        <div className="mb-4 rounded-md border border-danger-border bg-danger-bg p-3 text-danger">
            <div className="mb-1 text-13 font-medium">{title}</div>
            <pre className="whitespace-pre-wrap break-words font-mono text-xs">{message}</pre>
            {hint && <p className="mt-2 text-xs text-fg-muted">{hint}</p>}
        </div>
    );
}
