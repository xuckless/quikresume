import { expect, it, vi } from 'vitest';
it('reconnects the bridge after its port disconnects', async () => {
    let receive: any;
    const ports: any[] = [];
    vi.stubGlobal('__APP_URL__', 'https://app.example');
    vi.stubGlobal('location', { origin: 'https://app.example' });
    vi.stubGlobal('window', { addEventListener: (name: string, fn: any) => { if (name === 'message') receive = fn; }, postMessage: vi.fn() });
    vi.stubGlobal('chrome', { runtime: {
        connect: () => { const p: any = { postMessage: vi.fn(), disconnect: vi.fn(), onMessage: { addListener: vi.fn() }, onDisconnect: { addListener: (fn: any) => { p.drop = fn; } } }; ports.push(p); return p; },
        sendMessage: vi.fn().mockResolvedValue({ paired: true }), getManifest: () => ({ version: '1' }),
    } });
    vi.stubGlobal('defineContentScript', (config: any) => config.main());
    await import('../entrypoints/site.content');
    const send = () => receive({ source: window, origin: location.origin, data: { source: 'quikresume-app', type: 'profile-start', id: 'run' } });
    await send();
    ports[0].drop();
    await send();
    expect(ports).toHaveLength(2);
    expect(ports[1].postMessage).toHaveBeenCalled();
    vi.unstubAllGlobals();
});
