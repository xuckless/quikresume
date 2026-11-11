// src/components/ui/use-page-count.ts
"use client";

// Compiles the resume in the background (debounced) and reports how many A4
// pages it renders to. Mount only where the number is shown: the first call
// loads the Typst wasm.

import { useEffect, useState } from "react";
import type { ResumeData } from "@/types/schema";
import { toTypstDoc, type TypstResumeDoc } from "@/lib/typst/doc";
import { compileSvg, ensureTypst } from "@/lib/typst/client";

const DEBOUNCE_MS = 600;

export type PageCount =
    | { status: "pending"; pages: null; error: false }
    | { status: "ready"; pages: number; error: false }
    | { status: "failed"; pages: null; error: true };
type PageCountResult = { source: string; result: PageCount };

export function useResumePageCount(data: ResumeData): PageCount {
    const docJson = JSON.stringify(toTypstDoc(data));
    const [state, setState] = useState<PageCountResult>({ source: docJson, result: { status: "pending", pages: null, error: false } });

    useEffect(() => {
        const lifetime = new AbortController();
        const timer = setTimeout(async () => {
            try {
                await ensureTypst();
                const result = await compileSvg(JSON.parse(docJson) as TypstResumeDoc);
                if (!lifetime.signal.aborted) setState({ source: docJson, result: { status: "ready", pages: result.pageCount, error: false } });
            } catch (err) {
                console.error("[page-count] compile failed:", err);
                if (!lifetime.signal.aborted) setState({ source: docJson, result: { status: "failed", pages: null, error: true } });
            }
        }, DEBOUNCE_MS);
        return () => {
            lifetime.abort();
            clearTimeout(timer);
        };
    }, [docJson]);

    return state.source === docJson ? state.result : { status: "pending", pages: null, error: false };
}
