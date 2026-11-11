// src/components/ui/library/stale-tags-notice.tsx
"use client";

// Items whose smart tags are older than their content are matched on stale skills. Tags are no longer
// shown in the UI, so this one line is the only place they surface: a count and a button that re-runs
// the tagger (POST /api/tags/backfill) for the changed items.

import React from "react";
import { useRouter } from "next/navigation";
import type { ResumeData } from "@/types/schema";
import { staleCount } from "@/lib/tags/content";
import { readJson } from "@/lib/ui/fetch-json";
import { useOperation } from "@/lib/ui/use-operation";
import { Button } from "@/components/ui/primitives/button";
import { NoticeBanner } from "@/components/ui/primitives/notice-banner";

export function StaleTagsNotice({ data }: { data: ResumeData }) {
    const router = useRouter();
    const analyse = useOperation<"analyse">();
    const error = analyse.error;
    const stale = staleCount(data);
    if (stale === 0 && !error) return null;

    const run = async () => {
        const done = await analyse.run("analyse", async () => {
            const res = await fetch("/api/tags/backfill", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force: false }) });
            const json = await readJson<{ tagged: number; skipped: number }>(res);
            if (!json.ok) throw new Error(json.error ?? "Analysis failed.");
        }, "Analysis failed.");
        if (done?.ok) router.refresh();
    };

    return (
        <NoticeBanner tone={error ? "danger" : "warning"} onDismiss={error ? () => analyse.reset() : undefined}>
            <span className="flex flex-wrap items-center justify-between gap-2">
                <span>
                    {error ?? `${stale} ${stale === 1 ? "item has" : "items have"} changed since skills were last detected. Job scores use the old skills until you analyse ${stale === 1 ? "it" : "them"}.`}
                </span>
                <Button size="sm" onClick={() => void run()} loading={analyse.running !== null}>Analyse {stale}</Button>
            </span>
        </NoticeBanner>
    );
}
