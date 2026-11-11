// src/components/start/guest-claim.tsx
"use client";

// Mounted in the signed-in shell. When this browser still holds a /start draft (lib/guest/draft-store.ts),
// hand it to claimGuestDraft once, clear it, and say what happened.

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { claimGuestDraft, type ClaimResult } from "@/app/actions/guest-actions";
import { EMPTY_GUEST_DRAFT, guestDraftStore, hasClaimableDraft } from "@/lib/guest/draft-store";
import { jobHref } from "@/lib/ui/use-dashboard-view";
import { cn } from "@/lib/cn";
import { NoticeBanner } from "@/components/ui/primitives";

export function GuestClaim() {
    const router = useRouter();
    const started = useRef(false);
    // One-shot on mount, not a user action, so plain state rather than an operation (whose unmount
    // reset would drop the result when React Strict Mode re-runs effects in development).
    const [result, setResult] = useState<ClaimResult | null>(null);
    // The success note's countdown ended: play the exit (rise-out) before unmounting.
    const [leaving, setLeaving] = useState(false);

    useEffect(() => {
        if (started.current) return;
        started.current = true;
        const draft = guestDraftStore.get();
        if (!hasClaimableDraft(draft)) return;
        claimGuestDraft({ resume: draft.resume, source: draft.source, job: draft.job })
            .then(res => {
                if (res.ok) guestDraftStore.set(EMPTY_GUEST_DRAFT);
                setResult(res);
                router.refresh();
            })
            .catch(() => setResult({ ok: false, error: "Couldn't bring over what you did before signing in.", resume: "none", jobId: null }));
    }, [router]);

    if (!result) return null;
    const text = !result.ok ? result.error
        : [
            result.resume === "saved" && "Your imported résumé is in your library.",
            result.resume === "skipped-existing" && "You already had a library, so the imported résumé wasn't added.",
            result.resume === "failed" && "The imported résumé couldn't be saved; import it again from Import.",
            result.jobId && "The job you matched is in your Job Tracker.",
        ].filter(Boolean).join(" ");
    return (
        <div
            className={cn("group fixed top-16 right-4 z-50 max-w-md overflow-hidden rounded-md shadow-sm", leaving && "rise-out")}
            inert={leaving || undefined}
            onAnimationEnd={e => {
                if (leaving && e.target === e.currentTarget && e.animationName === "rise-out") { setResult(null); setLeaving(false); }
            }}
        >
            <NoticeBanner tone={result.ok ? "success" : "danger"} onDismiss={() => setResult(null)}>
                {text}{" "}
                {result.jobId && <Link className="font-medium underline underline-offset-2" href={jobHref(result.jobId)}>Open the full review</Link>}
            </NoticeBanner>
            {/* A success note leaves on its own: the bar runs down over 12 s and pauses while hovered or focused.
                An error stays until dismissed. */}
            {result.ok && (
                <span
                    aria-hidden
                    onAnimationEnd={() => setLeaving(true)}
                    className="toast-countdown absolute inset-x-0 bottom-0 h-0.5 origin-left bg-success/40 group-hover:[animation-play-state:paused] group-focus-within:[animation-play-state:paused]"
                />
            )}
        </div>
    );
}
