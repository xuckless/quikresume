"use client";

// Client side of the background coach review (/api/review/run).
//
// One request at a time per tab. Work asked for while a run is in flight is queued as batches, merged per
// kind: explicit ids are unioned into one batch, stale and outdated-brief requests each collapse into one.
// Explicit ids run before the other kinds, and each batch fires only its own onDone callbacks.
//
// Automatic runs (a `signature` and no ids) are fire-and-forget and never awaited by a save. They wait for
// the user to stop changing things (several accepts in a row become one review of the final text), are
// attempted once per signature per session, and are switched off for good when the server says GLM is
// disabled. Explicit runs (ids, or the outdated-brief scope) still work after that.
//
// When another tab holds the server-side review lock the server answers `busy`; the batch waits 60 s and
// tries once more before reporting an error.

import { useSyncExternalStore } from "react";
import { readJson } from "./fetch-json";

type Scope = "stale" | "outdated-brief";
type Work = { kind: "ids"; ids: string[] } | { kind: "stale" } | { kind: "outdated-brief" };

export interface RunResult {
    reviewed: number;
    remaining: number;
}

type Callback = (result: RunResult) => void;
interface Batch {
    work: Work;
    callbacks: Callback[];
}

/** The run in flight plus what waits behind it. `error` is the last failed run, kept while idle. */
type Execution =
    | { phase: "idle"; error: string | null }
    | { phase: "running" | "retry-wait"; active: Batch; queue: Batch[] };

type Automatic =
    | { phase: "enabled" }
    | { phase: "disabled" }
    | { phase: "debouncing"; timer: ReturnType<typeof setTimeout>; signature: string };

export interface ReviewRunState {
    running: boolean;
    /** Ids explicitly re-reviewed (spinners on those rows); empty during stale-only runs. */
    ids: readonly string[];
    error: string | null;
}

/** Quiet time before an automatic run starts; every new change restarts it. */
export const AUTO_REVIEW_DELAY_MS = 2500;
const BUSY_RETRY_MS = 60_000;
const FAILED = "The review could not run.";

const NO_IDS: readonly string[] = [];
const SERVER: ReviewRunState = { running: false, ids: NO_IDS, error: null };
const messageOf = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

function publicState(execution: Execution): ReviewRunState {
    if (execution.phase === "idle") return { running: false, ids: NO_IDS, error: execution.error };
    const { work } = execution.active;
    return { running: true, ids: work.kind === "ids" ? work.ids : NO_IDS, error: null };
}

function sameState(a: ReviewRunState, b: ReviewRunState): boolean {
    return a.running === b.running && a.error === b.error && a.ids === b.ids;
}

/** Each runner owns one serial queue. Exported so the workflow can be tested with a fake `request`. */
export function createReviewRunner(request: typeof fetch = (...args) => fetch(...args)) {
    let execution: Execution = { phase: "idle", error: null };
    let automatic: Automatic = { phase: "enabled" };
    let snapshot = SERVER;
    const attempted = new Set<string>();
    const listeners = new Set<() => void>();

    /** Moves the machine; subscribers hear about it only when what the UI sees has changed. */
    function transition(next: Execution) {
        execution = next;
        const state = publicState(next);
        if (sameState(state, snapshot)) return;
        snapshot = state;
        listeners.forEach(listener => listener());
    }

    function cancelPendingAutoReview() {
        if (automatic.phase !== "debouncing") return;
        clearTimeout(automatic.timer);
        automatic = { phase: "enabled" };
    }

    function disableAutomatic() {
        cancelPendingAutoReview();
        automatic = { phase: "disabled" };
    }

    async function post(work: Work, retried = false): Promise<RunResult> {
        const body = work.kind === "ids" ? { ids: work.ids } : work.kind === "outdated-brief" ? { scope: work.kind } : {};
        const res = await request("/api/review/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const reply = await readJson<{ reviewed: number; remaining: number; busy: boolean; disabled: boolean }>(res);
        if (reply.ok) return { reviewed: reply.reviewed ?? 0, remaining: reply.remaining ?? 0 };
        if (reply.busy && !retried) {
            // Another tab is reviewing: try once more after it has had time to finish.
            if (execution.phase === "running") transition({ ...execution, phase: "retry-wait" });
            await new Promise(resolve => setTimeout(resolve, BUSY_RETRY_MS));
            if (execution.phase === "retry-wait") transition({ ...execution, phase: "running" });
            return post(work, true);
        }
        if (reply.disabled) disableAutomatic();
        throw new Error(reply.error ?? FAILED);
    }

    async function drain(first: Batch) {
        let batch: Batch | undefined = first;
        while (batch) {
            let error: string | null = null;
            let result: RunResult = { reviewed: 0, remaining: 0 };
            try {
                result = await post(batch.work);
            } catch (err) {
                error = messageOf(err, FAILED);
            }
            // A callback may queue another pass (reReviewAll); the batch stays active until they all ran.
            for (const callback of batch.callbacks) {
                try {
                    callback(result);
                } catch (err) {
                    error = messageOf(err, "The review callback failed.");
                }
            }
            if (execution.phase === "idle") return;
            const [next, ...queue] = execution.queue;
            if (next) transition({ phase: "running", active: next, queue });
            else transition({ phase: "idle", error });
            batch = next;
        }
    }

    function start(opts: { ids?: string[]; scope?: Scope; onDone?: Callback }) {
        const work: Work = opts.ids?.length
            ? { kind: "ids", ids: [...new Set(opts.ids)] }
            : opts.scope === "outdated-brief"
              ? { kind: "outdated-brief" }
              : { kind: "stale" };
        const batch: Batch = { work, callbacks: opts.onDone ? [opts.onDone] : [] };

        if (execution.phase === "idle") {
            transition({ phase: "running", active: batch, queue: [] });
            void drain(batch);
            return;
        }

        const queue = [...execution.queue];
        const index = queue.findIndex(item => item.work.kind === work.kind);
        if (index < 0) {
            queue.push(batch);
        } else {
            const pending = queue[index];
            queue[index] = {
                work:
                    pending.work.kind === "ids" && work.kind === "ids"
                        ? { kind: "ids", ids: [...new Set([...pending.work.ids, ...work.ids])] }
                        : pending.work,
                callbacks: [...pending.callbacks, ...batch.callbacks],
            };
        }
        // Explicit item requests go first (Array.sort is stable, so the other kinds keep arrival order).
        queue.sort((a, b) => Number(b.work.kind === "ids") - Number(a.work.kind === "ids"));
        // The queue is not part of the public state, so this does not notify.
        transition({ ...execution, queue });
    }

    /**
     * Starts a review run. `ids` re-reviews those items (explicit, immediate); otherwise items whose text
     * changed. `signature` (stale ids + text hashes) makes an automatic run happen once per set of changes,
     * after AUTO_REVIEW_DELAY_MS without a newer change.
     */
    function kickReviews(opts: { ids?: string[]; scope?: Scope; signature?: string; onDone?: Callback } = {}) {
        const explicit = Boolean(opts.ids?.length) || opts.scope === "outdated-brief";
        if (explicit) {
            start(opts);
            return;
        }
        if (automatic.phase === "disabled") return;
        if (opts.signature === undefined) {
            start(opts);
            return;
        }
        const signature = opts.signature;
        if (attempted.has(signature)) return;
        // Debounced: a newer change replaces the pending run (the newest signature covers the final text).
        cancelPendingAutoReview();
        const timer = setTimeout(() => {
            automatic = { phase: "enabled" };
            attempted.add(signature);
            start({ onDone: opts.onDone });
        }, AUTO_REVIEW_DELAY_MS);
        automatic = { phase: "debouncing", timer, signature };
    }

    /** Runs "outdated-brief" reviews until nothing is left (or a pass makes no progress). */
    function reReviewAll(onProgress: Callback, onFinished: () => void) {
        const step = () =>
            kickReviews({
                scope: "outdated-brief",
                onDone: result => {
                    onProgress(result);
                    if (result.remaining > 0 && result.reviewed > 0) step();
                    else onFinished();
                },
            });
        step();
    }

    function subscribe(listener: () => void) {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    }

    return { kickReviews, cancelPendingAutoReview, reReviewAll, getSnapshot: () => snapshot, subscribe };
}

const runner = createReviewRunner();

export const { kickReviews, cancelPendingAutoReview, reReviewAll } = runner;

export function useReviewRunState(): ReviewRunState {
    return useSyncExternalStore(runner.subscribe, runner.getSnapshot, () => SERVER);
}
