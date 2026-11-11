// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
const save = vi.hoisted(() => vi.fn());
vi.mock('@/app/actions/user-actions', () => ({ saveLinkedInUrl: save }));
import { LinkedInImport } from '@/components/ui/linkedin-import';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('waits for a fresh extension reply before treating an installed paired extension as missing', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    save.mockResolvedValue('https://www.linkedin.com/in/alice');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ uid: 'alice' }) }));
    const post = vi.spyOn(window, 'postMessage').mockImplementation(data => {
        if (data.type === 'ping') setTimeout(() => window.dispatchEvent(new MessageEvent('message', { source: window, origin: window.location.origin, data: { source: 'quikresume-ext', type: 'hello', version: '0.1.0', paired: true, profileImport: true } })), 30);
    });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
        await act(async () => root.render(createElement(LinkedInImport, { url: 'https://www.linkedin.com/in/alice', onSavedUrl: vi.fn(), onParsed: vi.fn() })));
        await act(async () => {
            container.querySelector('button')!.click();
            await new Promise(resolve => setTimeout(resolve, 80));
        });
        expect(save).toHaveBeenCalledWith('https://www.linkedin.com/in/alice');
        expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'profile-start', uid: 'alice' }), window.location.origin);
    } finally {
        await act(async () => root.unmount());
        container.remove();
    }
});

it('uses the saved server URL when the import view has an empty stale value', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    save.mockClear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ uid: 'alice', linkedin: 'https://www.linkedin.com/in/alice' }) }));
    const post = vi.spyOn(window, 'postMessage').mockImplementation(data => {
        if (data.type === 'ping') setTimeout(() => window.dispatchEvent(new MessageEvent('message', { source: window, origin: window.location.origin, data: { source: 'quikresume-ext', type: 'hello', version: '0.1.0', paired: true, profileImport: true } })), 5);
    });
    // Native dialogs are not implemented by jsdom.
    HTMLDialogElement.prototype.showModal = vi.fn();
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
        await act(async () => root.render(createElement(LinkedInImport, { url: '', onSavedUrl: vi.fn(), onParsed: vi.fn() })));
        await act(async () => {
            container.querySelector('button')!.click();
            await new Promise(resolve => setTimeout(resolve, 80));
        });
        expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'profile-start', url: 'https://www.linkedin.com/in/alice' }), window.location.origin);
        expect(save).not.toHaveBeenCalled();
    } finally {
        await act(async () => root.unmount());
        container.remove();
    }
});
