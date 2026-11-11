// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { LinkedInImport } from '@/components/ui/linkedin-import';
import { emptyResumeData } from '@/types/schema';
vi.mock('@/app/actions/user-actions', () => ({ saveLinkedInUrl: vi.fn() }));

it('shows capture and processing in Import and delivers a queued result without accepting it', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const parsed = vi.fn();
    const progress = vi.fn();
    let resolveAnalysis!: (value: unknown) => void;
    const analysis = new Promise(resolve => { resolveAnalysis = resolve; });
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ uid: 'alice', linkedin: 'https://www.linkedin.com/in/alice' }) }).mockReturnValueOnce(analysis);
    vi.stubGlobal('fetch', fetchMock);
    const emit = (data: object) => window.dispatchEvent(new MessageEvent('message', { source: window, origin: window.location.origin, data: { source: 'quikresume-ext', ...data } }));
    const post = vi.spyOn(window, 'postMessage').mockImplementation(data => {
        if (data.type === 'ping') setTimeout(() => emit({ type: 'hello', version: '1', paired: true, profileImport: true }), 0);
    });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
        await act(async () => root.render(createElement(LinkedInImport, { url: '', onParsed: parsed, onSavedUrl: vi.fn(), onProgress: progress })));
        await act(async () => { container.querySelector('button')!.click(); await new Promise(r => setTimeout(r, 20)); });
        const id = post.mock.calls.find(([message]) => message.type === 'profile-start')![0].id;
        await act(async () => { emit({ type: 'profile-started', id }); emit({ type: 'profile-progress', id, phase: 'capturing' }); });
        expect(container.textContent).toContain('Reading your LinkedIn profile sections');
        await act(async () => { emit({ type: 'profile-text', id, url: 'https://www.linkedin.com/in/alice/', text: 'Alice profile with experience and skills', warnings: [] }); });
        expect(container.textContent).toContain('Processing your profile with AI');
        expect(parsed).not.toHaveBeenCalled();
        expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ id, phase: 'analyzing' }));
        // A duplicate capture cannot start a second paid analysis request.
        await act(async () => { emit({ type: 'profile-text', id, url: 'https://www.linkedin.com/in/alice', text: 'Duplicate', warnings: [] }); });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        await act(async () => { resolveAnalysis({ json: async () => ({ ok: true, fileName: 'LinkedIn profile', data: emptyResumeData(), warnings: [] }) }); });
        expect(parsed).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'LinkedIn profile' }), { id });
        expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'profile-result', id, ok: true }), window.location.origin);
    } finally {
        await act(async () => root.unmount());
        container.remove();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    }
});
