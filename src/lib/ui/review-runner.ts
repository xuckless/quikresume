"use client";

import { useSyncExternalStore } from "react";
import { readJson } from "./fetch-json";

type Scope = "stale" | "outdated-brief";
export interface RunResult { reviewed: number; remaining: number }
type Callback = (result: RunResult) => void;
type Work = { kind: "ids"; ids: string[] } | { kind: "stale" } | { kind: "outdated-brief" };
type Batch = { work: Work; callbacks: Callback[] };
type Execution =
    | { phase: "idle"; error: string | null }
    | { phase: "running" | "retry-wait"; active: Batch; queue: Batch[] };
type Automatic =
    | { phase: "enabled" }
    | { phase: "disabled" }
    | { phase: "debouncing"; timer: ReturnType<typeof setTimeout>; signature: string };
export interface ReviewRunState {
    readonly phase: Execution["phase"];
    /** Compatibility selectors; execution.phase is authoritative. */
    readonly running: boolean;
    readonly ids: readonly string[];
    readonly error: string | null;
}
export const AUTO_REVIEW_DELAY_MS = 2500;
const SERVER: ReviewRunState = { phase: "idle", running: false, ids: [], error: null };

/** Each instance owns one serial queue. Exported for isolated workflow tests. */
export function createReviewRunner(request: typeof fetch = (...args) => fetch(...args)) {
    let execution: Execution = { phase: "idle", error: null };
    let automatic: Automatic = { phase: "enabled" };
    const attempted = new Set<string>();
    const listeners = new Set<() => void>();
    let snapshot = SERVER;
    function transition(next: Execution) {
        execution = next;
        snapshot = next.phase === "idle"
            ? { phase: "idle", running: false, ids: [], error: next.error }
            : { phase: next.phase, running: true, ids: next.active.work.kind === "ids" ? next.active.work.ids : [], error: null };
        listeners.forEach(listener => listener());
    }
    function cancelPendingAutoReview() {
        if (automatic.phase === "debouncing") {
            clearTimeout(automatic.timer);
            automatic = { phase: "enabled" };
        }
    }
    function disableAutomatic() {
        cancelPendingAutoReview();
        automatic = { phase: "disabled" };
    }
    async function post(work: Work, retried = false): Promise<RunResult> {
        const body = work.kind === "ids" ? { ids: work.ids } : work.kind === "outdated-brief" ? { scope: work.kind } : {};
        const res = await request("/api/review/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const reply = await readJson<{ reviewed: number; remaining: number; busy: boolean; disabled: boolean }>(res);
        if (reply.ok) return { reviewed: reply.reviewed ?? 0, remaining: reply.remaining ?? 0 };
        if (reply.busy && !retried) {
            if (execution.phase !== "idle") transition({ ...execution, phase: "retry-wait" });
            await new Promise(resolve => setTimeout(resolve, 60_000));
            if (execution.phase !== "idle") transition({ ...execution, phase: "running" });
            return post(work, true);
        }
        if (reply.disabled) disableAutomatic();
        throw new Error(reply.error ?? "The review could not run.");
    }
    async function run(batch: Batch) {
        let error: string | null = null;
        let result: RunResult;
        try { result = await post(batch.work); }
        catch (err) {
            error = err instanceof Error ? err.message : "The review could not run.";
            result = { reviewed: 0, remaining: 0 };
        }
        // Callbacks may enqueue another pass; keep the current batch active until they finish.
        for (const callback of batch.callbacks) {
            try { callback(result); }
            catch (err) { error = err instanceof Error ? err.message : "The review callback failed."; }
        }
        if (execution.phase === "idle") return;
        const [next, ...queue] = execution.queue;
        if (next) {
            transition({ phase: "running", active: next, queue });
            void run(next);
        } else transition({ phase: "idle", error });
    }
    function start(opts: { ids?: string[]; scope?: Scope; onDone?: Callback }) {
        const work: Work = opts.ids?.length ? { kind: "ids", ids: [...new Set(opts.ids)] }
            : opts.scope === "outdated-brief" ? { kind: "outdated-brief" } : { kind: "stale" };
        const batch: Batch = { work, callbacks: opts.onDone ? [opts.onDone] : [] };
        if (execution.phase === "idle") {
            transition({ phase: "running", active: batch, queue: [] });
            void run(batch);
            return;
        }
        const queue = [...execution.queue];
        const index = queue.findIndex(item => item.work.kind === work.kind);
        if (index < 0) queue.push(batch);
        else {
            const pending = queue[index];
            queue[index] = {
                work: pending.work.kind === "ids" && work.kind === "ids"
                    ? { kind: "ids", ids: [...new Set([...pending.work.ids, ...work.ids])] } : pending.work,
                callbacks: [...pending.callbacks, ...batch.callbacks],
            };
        }
        // Explicit item requests take priority; stale and brief work retain their own scope/callbacks.
        queue.sort((a, b) => Number(b.work.kind === "ids") - Number(a.work.kind === "ids"));
        transition({ ...execution, queue });
    }
    function kickReviews(opts: { ids?: string[]; scope?: Scope; signature?: string; onDone?: Callback } = {}) {
        const explicit = Boolean(opts.ids?.length) || opts.scope === "outdated-brief";
        if (!explicit && opts.signature !== undefined) {
            if (automatic.phase === "disabled" || attempted.has(opts.signature)) return;
            cancelPendingAutoReview();
            const signature = opts.signature;
            const timer = setTimeout(() => {
                if (automatic.phase !== "debouncing" || automatic.signature !== signature) return;
                automatic = { phase: "enabled" };
                if (attempted.has(signature)) return;
                attempted.add(signature);
                start({ onDone: opts.onDone });
            }, AUTO_REVIEW_DELAY_MS);
            automatic = { phase: "debouncing", timer, signature };
            return;
        }
        if (!explicit && automatic.phase === "disabled") return;
        start(opts);
    }
    function reReviewAll(onProgress: Callback, onFinished: () => void) {
        const step = () => kickReviews({ scope: "outdated-brief", onDone: result => {
            onProgress(result);
            if (result.remaining > 0 && result.reviewed > 0) step();
            else onFinished();
        } });
        step();
    }
    return { kickReviews, cancelPendingAutoReview, reReviewAll, getSnapshot: () => snapshot,
        subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
}
const runner = createReviewRunner();
export const { kickReviews, cancelPendingAutoReview, reReviewAll } = runner;
export function useReviewRunState(): ReviewRunState {
    return useSyncExternalStore(runner.subscribe, runner.getSnapshot, () => SERVER);
}
