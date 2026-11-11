import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('./api', () => ({ ...apiMock, appUrl: () => 'https://app.example', getToken: vi.fn(), clearToken: vi.fn(), setToken: vi.fn(), apiBytes: vi.fn() }));

const event = () => {
    const listeners: Array<(...args: any[]) => any> = [];
    return { addListener: (fn: (...args: any[]) => any) => listeners.push(fn), emit: async (...args: any[]) => { for (const fn of listeners) await fn(...args); } };
};
let connect: ReturnType<typeof event>;
let messages: ReturnType<typeof event>;
let disconnected: ReturnType<typeof event>;
let port: any;
let store: Record<string, any>;
let chromeMock: any;
const id = '12345678-1234-1234-1234-123456789abc';
const start = () => messages.emit({ type: 'profile-start', id, uid: 'alice', url: 'https://www.linkedin.com/in/Alice' });
const state = () => store['tab:42']?.profileImport;

beforeEach(async () => {
    vi.resetModules();
    store = {};
    connect = event(); messages = event(); disconnected = event();
    port = { name: 'profile-import', sender: { tab: { id: 1 }, url: 'https://app.example/dashboard' }, onMessage: messages, onDisconnect: disconnected, postMessage: vi.fn(), disconnect: vi.fn() };
    chromeMock = {
        runtime: { onConnect: connect, onMessage: event(), sendMessage: vi.fn().mockResolvedValue(undefined) },
        storage: { session: { get: async (k: string) => ({ [k]: store[k] }), set: async (v: object) => { Object.assign(store, v); }, remove: vi.fn() }, onChanged: event() },
        tabs: { create: vi.fn().mockResolvedValue({ id: 42 }), get: vi.fn().mockResolvedValue({ url: 'https://www.linkedin.com/in/alice' }), sendMessage: vi.fn().mockResolvedValue({ ok: true, text: 'Alice profile with work experience', warnings: [] }), onUpdated: event(), onRemoved: event() },
        sidePanel: { open: vi.fn().mockResolvedValue(undefined), setPanelBehavior: vi.fn().mockResolvedValue(undefined) },
        scripting: { executeScript: vi.fn().mockResolvedValue([]) },
        action: { setBadgeText: vi.fn().mockResolvedValue(undefined), setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined) },
    };
    vi.stubGlobal('chrome', chromeMock);
    vi.stubGlobal('defineBackground', (fn: () => void) => fn());
    apiMock.api.mockReset().mockResolvedValue({ user: { id: 'alice' } });
    await import('../entrypoints/background');
    await connect.emit(port);
});

describe('profile session lifecycle', () => {
    it('normalizes tab state retained from an older extension version', async () => {
        store['tab:42'] = { posting: null, summary: null, saving: false, error: null };
        const reply = vi.fn();
        await chromeMock.runtime.onMessage.emit({ type: 'tab-state', tabId: 42 }, {}, reply);
        await vi.waitFor(() => expect(reply).toHaveBeenCalledWith(expect.objectContaining({ operation: { phase: 'idle' } })));
    });
    it('injects the profile script when a pre-existing tab has no listener', async () => {
        await start();
        let attempts = 0;
        chromeMock.tabs.sendMessage.mockImplementation(async (_tabId: number, message: { type: string }) => {
            if (message.type !== 'capture-profile') return;
            if (++attempts === 1) throw new Error('Receiving end does not exist');
            return { ok: true, text: 'Alice profile with work experience', warnings: [] };
        });
        await chromeMock.runtime.onMessage.emit({ type: 'profile-capture', tabId: 42 }, {}, vi.fn());
        await vi.waitFor(() => expect(state().phase).toBe('analyzing'));
        expect(chromeMock.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 42 }, files: ['/content-scripts/profile.js'] });
        expect(attempts).toBe(2);
    });
    it('rejects a different website account before opening LinkedIn', async () => {
        apiMock.api.mockResolvedValue({ user: { id: 'bob' } });
        await start();
        expect(chromeMock.tabs.create).not.toHaveBeenCalled();
        expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'profile-error', id }));
    });
    it('rejects ports outside the app origin', async () => {
        const foreign = { ...port, sender: { tab: { id: 3 }, url: 'https://evil.example/dashboard' }, disconnect: vi.fn() };
        await connect.emit(foreign);
        expect(foreign.disconnect).toHaveBeenCalled();
    });
    it('captures once, waits for parsing, ignores stale results, and marks review ready', async () => {
        await start();
        const send = async () => { await chromeMock.runtime.onMessage.emit({ type: 'profile-capture', tabId: 42 }, {}, vi.fn()); await vi.waitFor(() => expect(state().phase).toBe('analyzing')); };
        await send();
        expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'profile-text', id }));
        await send();
        expect(chromeMock.tabs.sendMessage.mock.calls.filter((c: any[]) => c[1].type === 'capture-profile')).toHaveLength(1);
        await messages.emit({ type: 'profile-result', id: 'stale', ok: true });
        expect(state().phase).toBe('analyzing');
        await messages.emit({ type: 'profile-result', id, ok: false, error: 'AI unavailable' });
        expect(state()).toMatchObject({ phase: 'error', error: 'AI unavailable' });
        await send();
        await messages.emit({ type: 'profile-result', id, ok: true });
        expect(state().phase).toBe('ready');
    });
    it('invalidates cancelled and disconnected sessions', async () => {
        await start();
        await messages.emit({ type: 'profile-cancel', id: 'stale' });
        expect(state().phase).toBe('waiting');
        await messages.emit({ type: 'profile-cancel', id });
        expect(state()).toBeUndefined();
        await messages.emit({ type: 'profile-result', id, ok: true });
        expect(state()).toBeUndefined();
        await start();
        await disconnected.emit();
        await vi.waitFor(() => expect(state()).toBeUndefined());
    });
    it('ignores a pending start after cancellation', async () => {
        let resolve!: (value: any) => void;
        apiMock.api.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
        const pending = start();
        await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
        await messages.emit({ type: 'profile-cancel', id });
        resolve({ user: { id: 'alice' } });
        await pending;
        expect(chromeMock.tabs.create).not.toHaveBeenCalled();
        expect(state()).toBeUndefined();
    });
    it('ignores capture completion after disconnect', async () => {
        await start();
        let resolve!: (value: any) => void;
        chromeMock.tabs.sendMessage.mockImplementation((_tab: number, m: any) => m.type === 'capture-profile' ? new Promise(r => { resolve = r; }) : Promise.resolve());
        await chromeMock.runtime.onMessage.emit({ type: 'profile-capture', tabId: 42 }, {}, vi.fn());
        await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
        await disconnected.emit();
        resolve({ ok: true, text: 'late capture' });
        await vi.waitFor(() => expect(state()).toBeUndefined());
        expect(port.postMessage.mock.calls.some((args: any[]) => args[0].type === 'profile-text')).toBe(false);
    });
    it('blocks a changed URL before DOM capture', async () => {
        await start();
        chromeMock.tabs.get.mockResolvedValue({ url: 'https://www.linkedin.com/in/bob' });
        await chromeMock.runtime.onMessage.emit({ type: 'profile-capture', tabId: 42 }, {}, vi.fn());
        await vi.waitFor(() => expect(state().phase).toBe('error'));
        expect(chromeMock.tabs.sendMessage.mock.calls.filter((c: any[]) => c[1].type === 'capture-profile')).toHaveLength(0);
        expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'profile-capture-error', id }));
    });
});
