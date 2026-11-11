import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTO_REVIEW_DELAY_MS, createReviewRunner } from "../src/lib/ui/review-runner";

const reply = (body: object) => new Response(JSON.stringify(body));
const success = (reviewed = 1, remaining = 0) => reply({ ok: true, reviewed, remaining });
const bodies = (request: ReturnType<typeof vi.fn<typeof fetch>>) =>
    request.mock.calls.map(call => JSON.parse(call[1]!.body as string));

async function flush() {
    for (let i = 0; i < 100; i++) await Promise.resolve();
}

/** A request whose first response is held until the test releases it. */
function gatedRequest() {
    let release!: (response: Response) => void;
    const request = vi
        .fn<typeof fetch>()
        .mockImplementationOnce(() => new Promise<Response>(resolve => (release = resolve)))
        .mockImplementation(async () => success());
    return { request, release: (response: Response = success()) => release(response) };
}

afterEach(() => vi.useRealTimers());

describe("review runner: automatic runs", () => {
    it("debounces to the newest signature, attempts each signature once, and can be cancelled", async () => {
        vi.useFakeTimers();
        const request = vi.fn<typeof fetch>().mockImplementation(async () => success());
        const runner = createReviewRunner(request);
        const superseded = vi.fn();
        runner.kickReviews({ signature: "old", onDone: superseded });
        await vi.advanceTimersByTimeAsync(2000);
        runner.kickReviews({ signature: "new" });
        await vi.advanceTimersByTimeAsync(AUTO_REVIEW_DELAY_MS - 1);
        expect(request).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(request).toHaveBeenCalledTimes(1);
        expect(superseded).not.toHaveBeenCalled();

        runner.kickReviews({ signature: "new" });
        runner.kickReviews({ signature: "cancelled" });
        runner.cancelPendingAutoReview();
        await vi.advanceTimersByTimeAsync(AUTO_REVIEW_DELAY_MS);
        expect(request).toHaveBeenCalledTimes(1);
    });

    it("after the server reports disabled, automatic runs stop but explicit ones still work", async () => {
        vi.useFakeTimers();
        const request = vi
            .fn<typeof fetch>()
            .mockImplementationOnce(async () => reply({ ok: false, disabled: true, error: "disabled" }))
            .mockImplementation(async () => success());
        const runner = createReviewRunner(request);
        runner.kickReviews({ ids: ["a"] });
        runner.kickReviews({ signature: "pending" });
        await flush();
        expect(runner.getSnapshot()).toEqual({ running: false, ids: [], error: "disabled" });

        // The pending debounce was dropped, and neither a bare nor a signed automatic kick starts anything.
        runner.kickReviews();
        runner.kickReviews({ signature: "later" });
        await vi.advanceTimersByTimeAsync(AUTO_REVIEW_DELAY_MS);
        expect(request).toHaveBeenCalledTimes(1);

        // Explicit ids and the outdated-brief scope are unaffected.
        runner.kickReviews({ ids: ["retry"] });
        await flush();
        runner.kickReviews({ scope: "outdated-brief" });
        await flush();
        expect(bodies(request)).toEqual([{ ids: ["a"] }, { ids: ["retry"] }, { scope: "outdated-brief" }]);
        expect(runner.getSnapshot().error).toBeNull();
    });
});

describe("review runner: queue", () => {
    it("runs one request at a time, merges queued work per kind, runs ids first, and keeps callbacks per batch", async () => {
        const { request, release } = gatedRequest();
        const runner = createReviewRunner(request);
        const stale = vi.fn();
        const brief = vi.fn();
        const idsA = vi.fn();
        const idsB = vi.fn();
        runner.kickReviews({ ids: ["first"] });
        runner.kickReviews({ onDone: stale });
        runner.kickReviews({ scope: "outdated-brief", onDone: brief });
        runner.kickReviews({ ids: ["a", "a"], onDone: idsA });
        runner.kickReviews({ ids: ["b", "a"], onDone: idsB });
        expect(request).toHaveBeenCalledTimes(1);
        expect(runner.getSnapshot()).toEqual({ running: true, ids: ["first"], error: null });

        release();
        await flush();
        expect(bodies(request)).toEqual([{ ids: ["first"] }, { ids: ["a", "b"] }, {}, { scope: "outdated-brief" }]);
        for (const callback of [stale, brief, idsA, idsB]) {
            expect(callback).toHaveBeenCalledExactlyOnceWith({ reviewed: 1, remaining: 0 });
        }
        expect(runner.getSnapshot()).toEqual({ running: false, ids: [], error: null });
    });

    it("fires a batch's callbacks when its own run finishes, not after the next one", async () => {
        const { request, release } = gatedRequest();
        const runner = createReviewRunner(request);
        const first = vi.fn();
        const second = vi.fn();
        runner.kickReviews({ ids: ["a"], onDone: first });
        runner.kickReviews({ onDone: second });
        release(success(3, 1));
        await flush();
        expect(first).toHaveBeenCalledExactlyOnceWith({ reviewed: 3, remaining: 1 });
        expect(second).toHaveBeenCalledExactlyOnceWith({ reviewed: 1, remaining: 0 });
    });

    it("notifies subscribers only when the visible state changes", async () => {
        const { request, release } = gatedRequest();
        const runner = createReviewRunner(request);
        const listener = vi.fn();
        runner.subscribe(listener);
        runner.kickReviews({ ids: ["a"] });
        expect(listener).toHaveBeenCalledTimes(1);
        runner.kickReviews({ ids: ["b"] });
        expect(listener).toHaveBeenCalledTimes(1);
        release();
        await flush();
        // a -> b -> idle
        expect(listener).toHaveBeenCalledTimes(3);
    });
});

describe("review runner: failures", () => {
    it("waits 60 s on a busy reply, retries once, then reports the error", async () => {
        vi.useFakeTimers();
        const request = vi.fn<typeof fetch>().mockImplementation(async () => reply({ ok: false, busy: true, error: "busy" }));
        const runner = createReviewRunner(request);
        const done = vi.fn();
        runner.kickReviews({ ids: ["a"], onDone: done });
        await flush();
        expect(runner.getSnapshot().running).toBe(true);
        await vi.advanceTimersByTimeAsync(59_999);
        expect(request).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(request).toHaveBeenCalledTimes(2);
        expect(runner.getSnapshot()).toEqual({ running: false, ids: [], error: "busy" });
        expect(done).toHaveBeenCalledExactlyOnceWith({ reviewed: 0, remaining: 0 });
    });

    it("a busy reply followed by success completes normally", async () => {
        vi.useFakeTimers();
        const request = vi
            .fn<typeof fetch>()
            .mockImplementationOnce(async () => reply({ ok: false, busy: true, error: "busy" }))
            .mockImplementation(async () => success());
        const runner = createReviewRunner(request);
        const done = vi.fn();
        runner.kickReviews({ onDone: done });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(done).toHaveBeenCalledExactlyOnceWith({ reviewed: 1, remaining: 0 });
        expect(runner.getSnapshot().error).toBeNull();
    });

    it("keeps a failed run's error while idle and clears it when the next run starts", async () => {
        const request = vi
            .fn<typeof fetch>()
            .mockRejectedValueOnce(new Error("offline"))
            .mockImplementation(async () => success());
        const runner = createReviewRunner(request);
        runner.kickReviews({ ids: ["a"] });
        await flush();
        expect(runner.getSnapshot()).toEqual({ running: false, ids: [], error: "offline" });
        runner.kickReviews({ ids: ["b"] });
        expect(runner.getSnapshot()).toEqual({ running: true, ids: ["b"], error: null });
        await flush();
        expect(runner.getSnapshot().error).toBeNull();
    });

    it("turns a throwing callback into the error and still runs queued work", async () => {
        const request = vi.fn<typeof fetch>().mockImplementation(async () => success());
        const runner = createReviewRunner(request);
        const done = vi.fn();
        runner.kickReviews({
            onDone: () => {
                throw new Error("callback broke");
            },
        });
        runner.kickReviews({ ids: ["next"], onDone: done });
        await flush();
        expect(done).toHaveBeenCalledTimes(1);
        expect(request).toHaveBeenCalledTimes(2);
        expect(runner.getSnapshot()).toEqual({ running: false, ids: [], error: null });

        runner.kickReviews({
            onDone: () => {
                throw new Error("callback broke");
            },
        });
        await flush();
        expect(runner.getSnapshot().error).toBe("callback broke");
    });
});

describe("review runner: reReviewAll", () => {
    it("keeps going while passes make progress and stops when one does not", async () => {
        const request = vi
            .fn<typeof fetch>()
            .mockImplementationOnce(async () => success(2, 3))
            .mockImplementationOnce(async () => success(0, 3));
        const runner = createReviewRunner(request);
        const progress = vi.fn();
        const finished = vi.fn();
        runner.reReviewAll(progress, finished);
        await flush();
        expect(bodies(request)).toEqual([{ scope: "outdated-brief" }, { scope: "outdated-brief" }]);
        expect(progress).toHaveBeenCalledTimes(2);
        expect(finished).toHaveBeenCalledTimes(1);
        expect(runner.getSnapshot().running).toBe(false);
    });
});
