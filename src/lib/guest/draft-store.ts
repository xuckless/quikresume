// src/lib/guest/draft-store.ts
"use client";

// The signed-out /start funnel keeps everything in this browser (localStorage) until the visitor signs
// in; <GuestClaim> in the dashboard shell then hands it to claimGuestDraft and clears it.

import { createPersistedStore } from "@/lib/ui/persisted-store";
import type { ResumeData } from "@/types/schema";
import type { Requirement } from "@/lib/match/types";

export interface GuestJob {
    title: string;
    company: string;
    jdText: string;
    requirements: Requirement[];
}

export interface GuestDraft {
    v: 1;
    step: "import" | "profile" | "template" | "job" | "teaser";
    resume: ResumeData | null;
    /** "sample" = the visitor tried a sample résumé (never claimed into their library). */
    source: "upload" | "sample" | null;
    fileName: string;
    field: string;
    role: string;
    job: GuestJob | null;
}

export const EMPTY_GUEST_DRAFT: GuestDraft = { v: 1, step: "import", resume: null, source: null, fileName: "", field: "", role: "", job: null };

export const guestDraftStore = createPersistedStore<GuestDraft>({
    key: "quikresume.guestDraft",
    storage: "local",
    initial: EMPTY_GUEST_DRAFT,
    deserialize: s => {
        const v = JSON.parse(s) as GuestDraft;
        return v && v.v === 1 ? { ...EMPTY_GUEST_DRAFT, ...v } : EMPTY_GUEST_DRAFT;
    },
});

export const hasClaimableDraft = (d: GuestDraft) => (d.source === "upload" && d.resume !== null) || d.job !== null;
