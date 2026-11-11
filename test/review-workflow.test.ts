import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTO_REVIEW_DELAY_MS, createReviewRunner } from "../src/lib/ui/review-runner";

const reply = (body: object) => new Response(JSON.stringify(body));
const success = () => reply({ ok: true, reviewed: 1, remaining: 0 });
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
afterEach(() => vi.useRealTimers());

describe("background review workflow", () => {
    it("debounces the latest signature, deduplicates attempts, and cancels pending work", async () => {
        vi.useFakeTimers();
        const request = vi.fn<typeof fetch>().mockImplementation(async () => success());
        const runner = createReviewRunner(request);
        const old = vi.fn();
        runner.kickReviews({ signature: "old", onDone: old });
        await vi.advanceTimersByTimeAsync(2000);
        runner.kickReviews({ signature: "new" });
        await vi.advanceTimersByTimeAsync(AUTO_REVIEW_DELAY_MS - 1);
        expect(request).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(request).toHaveBeenCalledTimes(1);
        expect(old).not.toHaveBeenCalled();
        runner.kickReviews({ signature: "new" });
        runner.kickReviews({ signature: "cancel" });
        runner.cancelPendingAutoReview();
        await vi.advanceTimersByTimeAsync(AUTO_REVIEW_DELAY_MS);
        expect(request).toHaveBeenCalledTimes(1);
    });

    it("serializes work, merges queued IDs, and preserves stale/brief scope and callbacks", async () => {
        let release!: (response: Response) => void;
        const request = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
            .mockImplementation(async () => success());
        const runner = createReviewRunner(request);
        const stale = vi.fn(), brief = vi.fn(), explicit = vi.fn();
        runner.kickReviews({ ids: ["first"] });
        runner.kickReviews({ onDone: stale });
        runner.kickReviews({ scope: "outdated-brief", onDone: brief });
        runner.kickReviews({ ids: ["a", "a"], onDone: explicit });
        runner.kickReviews({ ids: ["b", "a"] });
        expect(request).toHaveBeenCalledTimes(1);
        expect(runner.getSnapshot()).toMatchObject({ phase: "running", ids: ["first"] });
        release(success());
        await flush();
        expect(request.mock.calls.map(call => JSON.parse(call[1]!.body as string))).toEqual([
            { ids: ["first"] }, { ids: ["a", "b"] }, {}, { scope: "outdated-brief" },
        ]);
        for (const callback of [stale, brief, explicit]) expect(callback).toHaveBeenCalledExactlyOnceWith({ reviewed: 1, remaining: 0 });
        expect(runner.getSnapshot()).toMatchObject({ phase: "idle", running: false, ids: [], error: null });
    });

    it("waits and retries busy responses only once while holding the queue", async () => {
        vi.useFakeTimers();
        const request = vi.fn<typeof fetch>().mockImplementation(async () => reply({ ok: false, busy: true, error: "busy" }));
        const runner = createReviewRunner(request);
        const done = vi.fn();
        runner.kickReviews({ ids: ["a"], onDone: done });
        await flush();
        expect(runner.getSnapshot().phase).toBe("retry-wait");
        await vi.advanceTimersByTimeAsync(59999);
        expect(request).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(request).toHaveBeenCalledTimes(2);
        expect(runner.getSnapshot()).toMatchObject({ phase: "idle", error: "busy" });
        expect(done).toHaveBeenCalledExactlyOnceWith({ reviewed: 0, remaining: 0 });
    });

    it("disables automatic work on server refusal while allowing explicit recovery", async () => {
        vi.useFakeTimers();
        const request = vi.fn<typeof fetch>().mockImplementationOnce(async () => reply({ ok: false, disabled: true, error: "disabled" }))
            .mockImplementation(async () => success());
        const runner = createReviewRunner(request);
        runner.kickReviews({ ids: ["a"] });
        runner.kickReviews({ signature: "pending" });
        await flush();
        expect(runner.getSnapshot().error).toBe("disabled");
        runner.kickReviews();
        runner.kickReviews({ signature: "later" });
        await vi.advanceTimersByTimeAsync(AUTO_REVIEW_DELAY_MS);
        expect(request).toHaveBeenCalledTimes(1);
        runner.kickReviews({ ids: ["retry"] });
        await flush();
        expect(request).toHaveBeenCalledTimes(2);
        expect(runner.getSnapshot().error).toBeNull();
    });

    it("continues brief passes from callbacks and stops when no progress is made", async () => {
        const request = vi.fn<typeof fetch>()
            .mockImplementationOnce(async () => reply({ ok: true, reviewed: 2, remaining: 3 }))
            .mockImplementationOnce(async () => reply({ ok: true, reviewed: 0, remaining: 3 }));
        const runner = createReviewRunner(request);
        const progress = vi.fn(), finished = vi.fn();
        runner.reReviewAll(progress, finished);
        await flush();
        expect(request).toHaveBeenCalledTimes(2);
        expect(request.mock.calls.every(call => JSON.parse(call[1]!.body as string).scope === "outdated-brief")).toBe(true);
        expect(progress).toHaveBeenCalledTimes(2);
        expect(finished).toHaveBeenCalledTimes(1);
        expect(runner.getSnapshot().running).toBe(false);
    });

    it("recovers from network failures and callback exceptions without stranding queued work", async () => {
        const request = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("offline"))
            .mockImplementation(async () => success());
        const runner = createReviewRunner(request);
        const done = vi.fn();
        runner.kickReviews({ onDone: () => { throw new Error("callback"); } });
        runner.kickReviews({ ids: ["next"], onDone: done });
        await flush();
        expect(done).toHaveBeenCalledTimes(1);
        expect(runner.getSnapshot().phase).toBe("idle");
    });
});
