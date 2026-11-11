import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Posting } from "./types";

// The floating button's mount machine: however checks and mounts interleave, at most one button lives.
const posting = (n: number): Posting => ({ url: `https://jobs.example/${n}`, title: `Job ${n}`, company: "", location: "", employmentType: "", description: "text", method: "readable", site: "x" });

let current: Posting | null;
let mounts: { resolve: (fab?: unknown) => void; fab: { update: ReturnType<typeof vi.fn>; pulse: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> } }[];

beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    mounts = [];
    current = posting(1);
    delete (window as unknown as { __quikresumeDetector?: boolean }).__quikresumeDetector;
    vi.stubGlobal("chrome", { runtime: { sendMessage: vi.fn().mockResolvedValue(null), onMessage: { addListener: vi.fn() } } });
    vi.doMock("./extract", () => ({ extractPosting: () => current }));
    vi.doMock("./fab", () => ({
        mountFab: () => new Promise(resolve => {
            const fab = { update: vi.fn(), pulse: vi.fn(), remove: vi.fn() };
            mounts.push({ fab, resolve: (value = fab) => resolve(value) });
        }),
    }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.doUnmock("./extract"); vi.doUnmock("./fab"); });

async function start() {
    const { runDetector } = await import("./detector");
    runDetector();
    await vi.advanceTimersByTimeAsync(800);
    return () => { runDetector(); return vi.advanceTimersByTimeAsync(0); }; // a forced re-check
}

describe("floating button", () => {
    it("keeps one button when the posting changes while the first is still mounting", async () => {
        const recheck = await start();
        expect(mounts).toHaveLength(1);
        current = posting(2);
        await recheck();
        mounts[0]!.resolve();
        await vi.advanceTimersByTimeAsync(0);
        expect(mounts).toHaveLength(1); // no second mount started
        expect(mounts[0]!.fab.remove).not.toHaveBeenCalled();
        expect(mounts[0]!.fab.pulse).toHaveBeenCalled();
    });

    it("removes a button that finished mounting after the posting went away, and mounts afresh later", async () => {
        const recheck = await start();
        current = null;
        await recheck();
        mounts[0]!.resolve();
        await vi.advanceTimersByTimeAsync(0);
        expect(mounts[0]!.fab.remove).toHaveBeenCalledTimes(1);
        current = posting(3);
        await recheck();
        expect(mounts).toHaveLength(2);
        mounts[1]!.resolve();
        await vi.advanceTimersByTimeAsync(0);
        expect(mounts[1]!.fab.remove).not.toHaveBeenCalled();
    });

    it("tries again on the next change after a mount that produced no button (switched off)", async () => {
        const recheck = await start();
        mounts[0]!.resolve(null);
        await vi.advanceTimersByTimeAsync(0);
        current = posting(2);
        await recheck();
        expect(mounts).toHaveLength(2);
    });
});
