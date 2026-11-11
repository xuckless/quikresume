// src/components/start/guest-claim.tsx
"use client";

// Mounted in the signed-in shell. When this browser still holds a /start draft (lib/guest/draft-store.ts),
// hand it to claimGuestDraft once, clear it, and say what happened.

import React, { useEffect, useRef } from "react";
import { useFormsOperation } from "@/lib/ui/use-forms-operation";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { claimGuestDraft, type ClaimResult } from "@/app/actions/guest-actions";
import { EMPTY_GUEST_DRAFT, guestDraftStore, hasClaimableDraft } from "@/lib/guest/draft-store";
import { jobHref } from "@/lib/ui/use-dashboard-view";
import { NoticeBanner } from "@/components/ui/primitives";

export function GuestClaim() {
    const router = useRouter();
    const started = useRef(false);
    const claim = useFormsOperation<"claim", ClaimResult>();
    const result = claim.state.status === "succeeded" ? claim.state.result : null;

    useEffect(() => {
        if (started.current) return;
        started.current = true;
        const draft = guestDraftStore.get();
        if (!hasClaimableDraft(draft)) return;
        const id = claim.begin("claim");
        if (id === null) return;
        claimGuestDraft({ resume: draft.resume, source: draft.source, job: draft.job })
            .then(res => {
                if (!claim.active(id)) return;
                if (res.ok) guestDraftStore.set(EMPTY_GUEST_DRAFT);
                claim.succeed(id, res);
                router.refresh();
            })
            .catch(() => claim.succeed(id, { ok: false, error: "Couldn't bring over what you did before signing in.", resume: "none", jobId: null }));
        // The claim is intentionally attempted once for this mounted shell.
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
        <div className="group fixed top-16 right-4 z-50 max-w-md overflow-hidden rounded-md shadow-sm">
            <NoticeBanner tone={result.ok ? "success" : "danger"} onDismiss={() => claim.reset()}>
                {text}{" "}
                {result.jobId && <Link className="font-medium underline underline-offset-2" href={jobHref(result.jobId)}>Open the full review</Link>}
            </NoticeBanner>
            {/* A success note leaves on its own: the bar runs down over 12 s and pauses while hovered or focused.
                An error stays until dismissed. */}
            {result.ok && (
                <span
                    aria-hidden
                    onAnimationEnd={() => claim.reset()}
                    className="toast-countdown absolute inset-x-0 bottom-0 h-0.5 origin-left bg-success/40 group-hover:[animation-play-state:paused] group-focus-within:[animation-play-state:paused]"
                />
            )}
        </div>
    );
}
