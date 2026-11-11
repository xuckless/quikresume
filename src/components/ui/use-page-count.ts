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

export interface PageCount {
    /** Null while counting, and after a failed compile. */
    pages: number | null;
    /** The last compile failed (Typst error, wasm failed to load). */
    error: boolean;
}

export function useResumePageCount(data: ResumeData): PageCount {
    const docJson = JSON.stringify(toTypstDoc(data));
    const [state, setState] = useState<PageCount>({ pages: null, error: false });

    useEffect(() => {
        let cancelled = false;
        const timer = setTimeout(async () => {
            try {
                await ensureTypst();
                const result = await compileSvg(JSON.parse(docJson) as TypstResumeDoc);
                if (!cancelled) setState({ pages: result.pageCount, error: false });
            } catch (err) {
                console.error("[page-count] compile failed:", err);
                if (!cancelled) setState({ pages: null, error: true });
            }
        }, DEBOUNCE_MS);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [docJson]);

    return state;
}
