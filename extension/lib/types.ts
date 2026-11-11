// Shapes shared by the background worker, content scripts and the side panel.
// (Page <-> extension messages: src/lib/ext/bridge.ts. LinkedIn import: lib/linkedin-session.ts.)
import type { LinkedInRequest } from "./linkedin-session";

export type ExtractionMethod = "adapter" | "json-ld" | "readable";

export interface Posting {
    url: string;
    title: string;
    company: string;
    location: string;
    employmentType: string;
    description: string;
    method: ExtractionMethod;
    /** Adapter / site name for display ("LinkedIn", "Greenhouse", "this page"). */
    site: string;
}

export type JobStatus = "saved" | "applied" | "interview" | "offer" | "rejected";
export const JOB_STATUSES: JobStatus[] = ["saved", "applied", "interview", "offer", "rejected"];
export const JOB_STATUS_LABEL: Record<JobStatus, string> = { saved: "Saved", applied: "Applied", interview: "Interview", offer: "Offer", rejected: "Rejected" };

/** GET /api/ext/jobs/[id] summary (src/lib/ext/match-summary.ts in the app). */
export interface JobSummary {
    job: {
        id: string; title: string; company: string; status: JobStatus; url: string | null; location: string;
        appliedAt: string | null; variantId: string | null;
        match: { status: "idle" | "running" | "done" | "failed"; warning: string | null };
    };
    resume: { kind: "variant" | "selection"; variantId: string | null; name: string };
    score: number;
    band: number;
    gated: boolean;
    must: { hit: number; total: number };
    nice: { hit: number; total: number };
    subScores: Record<"coverage" | "ats" | "years" | "title" | "education", number | null>;
    missingMust: string[];
    whatIf: { display: string; importance: "must" | "nice"; gain: number }[];
}

export interface AutofillCounts {
    filled: number;
    drafted: number;
    attached: string | null;
    /** Labels of fields left for the user (no data, custom widget, etc.). */
    unmapped: string[];
}
export type AutofillReport = AutofillCounts & (
    | { phase: "running" | "complete"; error?: never }
    | { phase: "failed"; error: string }
);
export type Operation = { phase: "idle" | "saving"; error?: never } | { phase: "failed"; error: string };

/** Per-tab state the background keeps and the side panel renders. */
export interface TabState {
    posting: Posting | null;
    /** The saved job for this tab's posting; kept when the tab moves on to the application form. */
    summary: JobSummary | null;
    autofill: AutofillReport | null;
    /** True while the posting is being saved / analysed. */
    operation: Operation;
    /** Quick tailor run for the saved job (side panel). */
    tailor?: TailorState | null;
}

export type TailorSuggestion =
    | { id: string; kind: "item"; itemId: string; include: boolean; reason: string; source: "ai" | "trim"; label: string }
    | { id: string; kind: "sub"; itemId: string; key: string; hide: boolean; reason: string; source: "ai" | "trim"; label: string };

export interface TailorSelection { include: Record<string, boolean>; hidden: Record<string, string[]> }

export interface TailorResult {
    jobId: string;
    source: { kind: "variant" | "selection"; variantId: string | null; name: string };
    before: number;
    after: number;
    /** Pages after trimming (0 = could not be counted). */
    pages: number;
    base: TailorSelection;
    suggestions: TailorSuggestion[];
    warning?: string;
}

export type TailorState =
    | { phase: "running"; result?: never; error?: never }
    | { phase: "failed"; error: string; result?: never }
    | { phase: "review" | "saving"; result: TailorResult; error?: never }
    | { phase: "save-failed"; result: TailorResult; error: string };

export interface VariantInfo { id: string; name: string; labels: string[] }

/** The selection `base` with the chosen suggestions applied. */
export function applySuggestions(base: TailorSelection, chosen: TailorSuggestion[]): TailorSelection {
    const include = { ...base.include };
    const hidden: Record<string, string[]> = Object.fromEntries(Object.entries(base.hidden).map(([k, v]) => [k, [...v]]));
    for (const s of chosen) {
        if (s.kind === "item") include[s.itemId] = s.include;
        else {
            const keys = new Set(hidden[s.itemId] ?? []);
            if (s.hide) keys.add(s.key); else keys.delete(s.key);
            hidden[s.itemId] = [...keys];
        }
    }
    return { include, hidden };
}

export type BgRequest =
    | LinkedInRequest
    | { type: "detected"; posting: Posting | null }
    | { type: "open-panel" }
    | { type: "pair"; code: string }
    | { type: "status" }
    | { type: "signout" }
    | { type: "tab-state"; tabId: number }
    | { type: "scan"; tabId: number }
    | { type: "save"; tabId: number }
    | { type: "refresh"; tabId: number }
    | { type: "set-status"; tabId: number; status: JobStatus }
    | { type: "variants" }
    | { type: "set-variant"; tabId: number; variantId: string | null }
    | { type: "tailor"; tabId: number }
    | { type: "tailor-save"; tabId: number; name: string; selection: TailorSelection }
    | { type: "tailor-clear"; tabId: number }
    | { type: "connect-page" }
    | { type: "autofill"; tabId: number }
    | { type: "autofill-data"; needPdf: boolean }
    | { type: "autofill-answers"; questions: { id: string; label: string; options?: string[]; maxLength?: number }[] }
    | { type: "autofill-report"; filled: number; drafted: number; attached: string | null; unmapped: string[]; host: string };

export interface AccountStatus {
    paired: boolean;
    user: { id: string; name: string; email: string; image: string } | null;
    appUrl: string;
}
