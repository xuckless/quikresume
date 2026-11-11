import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ source: vi.fn(), created: vi.fn() }));
vi.mock('@myriaddreamin/typst.ts/contrib/snippet', () => ({ TypstSnippet: class {
    constructor() { mocks.created(); }
    static disableDefaultFontAssets() { return {}; }
    static preloadFonts() { return {}; }
    setCompilerInitOptions() {}
    setRendererInitOptions() {}
    use() {}
    addSource(...args: unknown[]) { return mocks.source(...args); }
} }));
beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.source.mockResolvedValue(undefined);
    vi.stubGlobal('window', {});
    vi.stubGlobal('sessionStorage', { removeItem: vi.fn(), getItem: vi.fn().mockReturnValue(null) });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => 'template' }));
});
afterEach(() => vi.unstubAllGlobals());
it('shares initialization and retains the ready instance', async () => {
    const client = await import('@/lib/typst/client');
    expect(client.getTypstStage()).toBe('idle');
    const first = client.ensureTypst();
    expect(client.getTypstStage()).toBe('loading');
    expect(client.ensureTypst()).toBe(first);
    await first;
    expect(client.getTypstStage()).toBe('ready');
    expect(client.ensureTypst()).toBe(first);
    expect(mocks.created).toHaveBeenCalledOnce();
});
it('records failed initialization and retries with a fresh instance', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.source.mockRejectedValueOnce(new Error('NetworkError'));
    const client = await import('@/lib/typst/client');
    await expect(client.ensureTypst()).rejects.toThrow('could not be downloaded');
    expect(client.getTypstStage()).toBe('failed');
    await client.ensureTypst();
    expect(client.getTypstStage()).toBe('ready');
    expect(mocks.created).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
});
