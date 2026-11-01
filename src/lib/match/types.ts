// src/lib/match/types.ts
// Job Match data model: analysed jobs, requirements, proposals, preferences.

import type { ResumeListKey } from "@/types/schema";
import type { TagKind } from "@/lib/tags/types";
import type { TagCarrier } from "@/lib/tags/aggregate";

export type Importance = "must" | "nice";

export interface Requirement {
    /** Normalised tag key (matches item tags). */
    name: string;
    display: string;
    kind: TagKind;
    importance: Importance;
    yearsMin: number | null;
    /**
     * Candidate tag keys that satisfy this requirement without being the same
     * key ("bachelor's degree" <- "bachelor of science"). Filled by the
     * reconcile pass (lib/match/reconcile.ts) against the candidate's library.
     */
    satisfiedBy: string[];
    /** Item ids the reconcile pass cited as demonstrating the requirement even without a tag. */
    evidence: string[];
    /** Short explanation from the reconcile pass ("" when it did nothing). */
    reason: string;
    /**
     * Semantic evidence over the whole library (lib/match/evidence.ts): the best unit per item, calibrated
     * probability that it demonstrates the requirement. Selection-independent; the scorer filters to
     * selected items and visible bullets. Empty when embeddings were not run.
     */
    semantic: SemanticHit[];
}

export interface SemanticHit {
    itemId: string;
    /** bulletKey of the unit (lib/sub-items.ts), null = the item as a whole. */
    bullet: string | null;
    /** Calibrated 0..1. */
    p: number;
    /** The line shown as evidence (bullet text or item title), ≤ 200 chars. */
    quote: string;
    /** Scored with the reranker too (false = cosine-only calibration). */
    reranked: boolean;
    /** The AI reconcile pass cited this item (true), saw it and did not (false), or did not run (null). */
    confirmed: boolean | null;
}

export type ProposalKind = "include" | "exclude" | "rewrite-bullet" | "add-skill" | "gap";
export type ProposalStatus = "open" | "applied" | "skipped" | "ignored";

export interface Proposal {
    id: string;
    kind: ProposalKind;
    section?: ResumeListKey;
    itemId?: string;
    itemLabel?: string;
    /** Requirement keys this proposal addresses. */
    tags: string[];
    /** rewrite-bullet: the exact current bullet line. add-skill: the category name. */
    current?: string;
    /** rewrite-bullet: the proposed line. add-skill: the skill to append. */
    proposed?: string;
    reason: string;
    status: ProposalStatus;
}

/** Application tracker column. Jobs analysed before the tracker existed read as "saved". */
export type JobStatus = "saved" | "applied" | "interview" | "offer" | "rejected";
export const JOB_STATUSES: JobStatus[] = ["saved", "applied", "interview", "offer", "rejected"];
export const JOB_STATUS_LABEL: Record<JobStatus, string> = { saved: "Saved", applied: "Applied", interview: "Interview", offer: "Offer", rejected: "Rejected" };
export const isJobStatus = (v: unknown): v is JobStatus => typeof v === "string" && (JOB_STATUSES as string[]).includes(v);

export type JobSourceKind = "paste" | "file" | "extension";

/** Tracker fields: user-owned state that a re-import of the same posting never overwrites. */
export interface JobTracking {
    status: JobStatus;
    /** ISO date (YYYY-MM-DD) the user applied; set automatically the first time status moves past "saved". */
    appliedAt: string | null;
    notes: string;
    /** Variant tailored for this job (autofill and the extension use it first). */
    variantId: string | null;
}

/** Posting fields that a re-import refreshes. */
export interface JobPosting {
    url: string | null;
    /** sha256 of the canonical URL (lib/jobs/canonical-url.ts); null for pasted / uploaded jobs. */
    urlKey: string | null;
    location: string;
    employmentType: string;
}

export interface JobRecord extends JobTracking, JobPosting {
    id: string;
    title: string;
    company: string;
    source: { kind: JobSourceKind; fileName: string | null };
    jdText: string;
    summary: string;
    requirements: Requirement[];
    proposals: Proposal[];
    proposalsAt: string | null;
    lastScore: number | null;
    /** Conflicts with the candidate's "About you" answers noticed while analysing (seniority, location, sponsorship). */
    fitNotes: string[];
    /** State of the background reconcile pass (lib/match/reconcile.ts `runReconcileJob`). */
    match: JobMatchState;
    /** Calibrated similarity of the job title to each work-experience item's title (item id -> 0..1). */
    titleSim: Record<string, number>;
    createdAt: string | null;
    updatedAt: string | null;
}

export type JobMatchStatus = "idle" | "running" | "done" | "failed";

export interface JobMatchState {
    /** "idle" = never run in the background (jobs analysed before it existed). A run past `runningUntil` reads as "failed". */
    status: JobMatchStatus;
    runningUntil: string | null;
    checkedAt: string | null;
    /** `reconcileLibraryHash` of the resume the verdicts were made against; lets Tailor reuse them. */
    libraryHash: string | null;
    warning: string;
}

export const IDLE_MATCH: JobMatchState = { status: "idle", runningUntil: null, checkedAt: null, libraryHash: null, warning: "" };

export interface MuteRule {
    kind: ProposalKind;
    tag?: string;
    itemId?: string;
}

/** null = uncapped. */
export type Caps = Record<ResumeListKey, number | null>;

export const DEFAULT_CAPS: Caps = {
    workExperience: 4,
    projects: 3,
    education: 2,
    skills: null,
    certifications: 3,
    awards: 3,
    volunteering: 3,
    publications: 3,
    languages: null,
};

/** A soft skill the user said they don't have (auto-tailor questionnaire). Warned about on later jobs until answered Yes. */
export interface DeclinedSkill {
    /** Requirement tag key. */
    name: string;
    display: string;
    at: string | null;
}

export interface Preferences {
    mutedProposals: MuteRule[];
    caps: Caps;
    declinedSoftSkills: DeclinedSkill[];
}

/** hard = named technologies, tools, credentials, languages (missing = disqualifying); soft = traits and practices (missing = keyword advice). */
export type RequirementTier = "hard" | "soft";

export interface MatchRow {
    requirement: Requirement;
    tier: RequirementTier;
    /** 0..1 */
    strength: number;
    /** True when at least one scored item covers the requirement (exact tag, satisfying tag or cited evidence). */
    tagHit: boolean;
    /** Number of distinct scored items covering the requirement. */
    weight: number;
    literalHit: boolean;
    items: TagCarrier[];
    /** Display names of the tags that covered it other than the exact key (e.g. "Bachelor of Science"). */
    via: string[];
    /** Reconcile-pass explanation when the hit is not an exact tag; "" otherwise. */
    reason: string;
    /** Strongest evidence on the scored résumé, best first (max one per item). */
    evidence: RowEvidence[];
    /** Score points gained if this requirement were fully evidenced (exact: the score is linear in strength). */
    gain: number;
    /** Years of dated evidence vs the posting's minimum; null when the posting names none. */
    years: { have: number; need: number } | null;
    /** ATS keyword placement: 1 = in the summary / skills / most recent role, 0.6 = elsewhere, 0 = absent. */
    placement: number;
}

/** How a piece of evidence was established, strongest first. */
export type EvidenceVia = "direct" | "related" | "semantic" | "keyword";

export interface RowEvidence {
    itemId: string;
    label: string;
    via: EvidenceVia;
    /** Evidence strength after recency, 0..1. */
    e: number;
    /** The quoted line (semantic hits) or "" (tag hits: the item title is the evidence). */
    quote: string;
}

export interface SubScores {
    /** Requirement coverage (meaning-level). */
    coverage: number;
    /** ATS literal keywords, weighted by placement (hard requirements). */
    ats: number | null;
    /** Years of experience vs the posting's minimums. */
    years: number | null;
    /** Job title similarity to your recent titles. */
    title: number | null;
    /** Degrees and credentials. */
    education: number | null;
}

export interface MatchResult {
    /** 0..100 */
    score: number;
    /** ± points (95%) from the uncertainty of the per-requirement evidence. */
    band: number;
    subScores: SubScores;
    /** True when a missing hard must-have capped the score (MUST_GATE_CAP). */
    gated: boolean;
    must: { hit: number; total: number };
    nice: { hit: number; total: number };
    rows: MatchRow[];
    /** Hard must-haves with no coverage at all: the disqualifiers. */
    missingMust: Requirement[];
    /** Soft requirements (traits / practices) with no coverage: keywords worth adding before applying. */
    keywordGaps: Requirement[];
}

/** Shape of one resume-side option in Job Match. */
export type ResumeSource =
    | { kind: "selection" }
    | { kind: "variant"; variantId: string }
    | { kind: "upload"; fileName: string };
