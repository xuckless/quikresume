import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real client module runs against a fake TypstSnippet, so these are the actual engine transitions
// (idle -> loading -> ready | failed | reloading) without wasm or a DOM.
const mocks = vi.hoisted(() => ({ addSource: vi.fn(), created: vi.fn() }));

vi.mock("@myriaddreamin/typst.ts/contrib/snippet", () => ({
    TypstSnippet: class {
        constructor() {
            mocks.created();
        }
        static disableDefaultFontAssets() {
            return {};
        }
        static preloadFonts() {
            return {};
        }
        setCompilerInitOptions() {}
        setRendererInitOptions() {}
        use() {}
        addSource(...args: unknown[]) {
            return mocks.addSource(...args);
        }
    },
}));

const reload = vi.fn();
const setItem = vi.fn();

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.addSource.mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("window", { location: { reload } });
    vi.stubGlobal("sessionStorage", { removeItem: vi.fn(), getItem: vi.fn().mockReturnValue(null), setItem });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "source" }));
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("Typst engine state", () => {
    it("shares one load and keeps the ready instance", async () => {
        const client = await import("@/lib/typst/client");
        expect(client.getTypstStage()).toBe("idle");
        const first = client.ensureTypst();
        expect(client.getTypstStage()).toBe("loading");
        expect(client.ensureTypst()).toBe(first);
        await first;
        expect(client.getTypstStage()).toBe("ready");
        expect(client.ensureTypst()).toBe(first);
        expect(mocks.created).toHaveBeenCalledOnce();
    });

    it("records a failed load as an engine error and starts a fresh load on the next call", async () => {
        mocks.addSource.mockRejectedValueOnce(new Error("NetworkError"));
        const client = await import("@/lib/typst/client");
        const failure = await client.ensureTypst().catch((err: unknown) => err);
        expect(client.isEngineError(failure)).toBe(true);
        expect((failure as Error).message).toContain("could not be downloaded");
        expect(client.getTypstStage()).toBe("failed");
        await client.ensureTypst();
        expect(client.getTypstStage()).toBe("ready");
        expect(mocks.created).toHaveBeenCalledTimes(2);
    });

    it("reloads once on a CSP block and keeps handing out the same pending promise", async () => {
        mocks.addSource.mockRejectedValueOnce(new Error("Refused: unsafe-eval is not allowed"));
        const client = await import("@/lib/typst/client");
        const pending = client.ensureTypst();
        const settled = vi.fn();
        void pending.then(settled, settled);
        await vi.waitFor(() => expect(client.getTypstStage()).toBe("reloading"));
        expect(reload).toHaveBeenCalledOnce();
        expect(setItem).toHaveBeenCalledOnce();
        expect(client.ensureTypst()).toBe(pending);
        expect(mocks.created).toHaveBeenCalledOnce();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(settled).not.toHaveBeenCalled();
    });

    it("does not reload twice for a CSP block: the second one is a plain engine error", async () => {
        vi.stubGlobal("sessionStorage", { removeItem: vi.fn(), getItem: vi.fn().mockReturnValue("1"), setItem });
        mocks.addSource.mockRejectedValueOnce(new Error("unsafe-eval blocked"));
        const client = await import("@/lib/typst/client");
        await expect(client.ensureTypst()).rejects.toThrow("security policy");
        expect(reload).not.toHaveBeenCalled();
        expect(client.getTypstStage()).toBe("failed");
    });
});
