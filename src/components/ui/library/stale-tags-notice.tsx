// src/components/ui/library/stale-tags-notice.tsx
"use client";

// Items whose smart tags are older than their content are matched on stale skills. Tags are no longer
// shown in the UI, so this one line is the only place they surface: a count and a button that re-runs
// the tagger (POST /api/tags/backfill) for the changed items.

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import type { ResumeData } from "@/types/schema";
import { staleCount } from "@/lib/tags/content";
import { readJson } from "@/lib/ui/fetch-json";
import { Button } from "@/components/ui/primitives/button";
import { NoticeBanner } from "@/components/ui/primitives/notice-banner";

export function StaleTagsNotice({ data }: { data: ResumeData }) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const stale = staleCount(data);
    if (stale === 0 && !error) return null;

    const run = async () => {
        setBusy(true);
        setError(null);
        try {
            const res = await fetch("/api/tags/backfill", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force: false }) });
            const json = await readJson<{ tagged: number; skipped: number }>(res);
            if (!json.ok) throw new Error(json.error ?? "Analysis failed.");
            router.refresh();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Analysis failed.");
        } finally {
            setBusy(false);
        }
    };

    return (
        <NoticeBanner tone={error ? "danger" : "warning"} onDismiss={error ? () => setError(null) : undefined}>
            <span className="flex flex-wrap items-center justify-between gap-2">
                <span>
                    {error ?? `${stale} ${stale === 1 ? "item has" : "items have"} changed since skills were last detected. Job scores use the old skills until you analyse ${stale === 1 ? "it" : "them"}.`}
                </span>
                <Button size="sm" onClick={run} loading={busy}>Analyse {stale}</Button>
            </span>
        </NoticeBanner>
    );
}
