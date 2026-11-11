import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ProfileImportCard } from '../entrypoints/sidepanel/ProfileImportCard';

afterEach(() => vi.unstubAllGlobals());

it.each([
    { url: 'https://www.linkedin.com/in/syed-alidirect/', reply: null, disabled: false },
    { url: 'https://linkedin.com/in/Syed-Alidirect/?trk=test#about', reply: { ready: true, loginWall: false }, disabled: false },
    { url: 'https://www.linkedin.com/in/someone-else/', reply: { ready: true, loginWall: false }, disabled: true },
    { url: 'https://www.linkedin.com/in/syed-alidirect/', reply: { ready: false, loginWall: true }, disabled: true },
])('sets Import disabled=$disabled for $url with probe $reply', async ({ url, reply, disabled }) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const sendMessage = reply ? vi.fn().mockResolvedValue(reply) : vi.fn().mockRejectedValue(new Error('Receiving end does not exist'));
    vi.stubGlobal('chrome', {
        tabs: { get: vi.fn().mockResolvedValue({ url }), sendMessage, onUpdated: { addListener: vi.fn(), removeListener: vi.fn() } },
        runtime: { sendMessage: vi.fn().mockResolvedValue(undefined) },
    });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
        await act(async () => root.render(createElement(ProfileImportCard, { tabId: 42, state: { id: 'test', url: 'https://www.linkedin.com/in/syed-alidirect', phase: 'waiting' } })));
        expect(container.querySelector('button')?.disabled).toBe(disabled);
        if (!disabled) {
            expect(container.textContent).not.toContain('Log into LinkedIn');
            expect(container.textContent).toContain('Profile URL matches');
        }
    } finally {
        await act(async () => root.unmount());
        container.remove();
    }
});
