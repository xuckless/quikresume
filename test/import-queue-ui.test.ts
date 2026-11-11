// @vitest-environment jsdom
import { act, createElement, useReducer } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ResumeImport } from '@/components/ui/resume-import';
import { importQueueTransition, type ImportJob } from '@/lib/import/queue';
import { emptyResumeData } from '@/types/schema';
vi.mock('@/components/ui/linkedin-import', () => ({ LinkedInImport: () => null }));
vi.mock('@/lib/import/pdf-pages', () => ({ documentFormData: vi.fn() }));

it('shows a queued result and filters duplicates until the user reviews and accepts', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const base = emptyResumeData();
    const data = emptyResumeData();
    const skill = { id: 'old', category: 'Languages', items: 'TypeScript', isSelected: true, tags: [], tagsHash: null, hidden: [] };
    base.skills = [skill];
    data.skills = [{ ...skill, id: 'duplicate' }, { ...skill, id: 'new', category: 'Tools', items: 'Git' }];
    const accepted = vi.fn();
    function Harness() {
        const [jobs, dispatch] = useReducer(importQueueTransition, [{ id: 'job', phase: 'ready', file: { fileName: 'LinkedIn profile', data, warnings: [] } }] as ImportJob[]);
        return createElement(ResumeImport, { jobs, onQueueEvent: dispatch, current: base, onImport: accepted, onSavedLinkedInUrl: vi.fn(), onCancel: vi.fn() });
    }
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const button = (text: string) => Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes(text))!;
    try {
        await act(async () => root.render(createElement(Harness)));
        expect(container.textContent).toContain('Ready to review. Nothing has been added yet.');
        expect(container.textContent).toContain('1 already there');
        expect(accepted).not.toHaveBeenCalled();
        await act(async () => button('Review import').click());
        expect(container.textContent).toContain('Already in library');
        expect(container.textContent).toContain('New');
        expect(accepted).not.toHaveBeenCalled();
        await act(async () => button('Add 1 item to editor draft').click());
        expect(accepted).toHaveBeenCalledOnce();
        expect(accepted.mock.calls[0][0].items.skills.map((item: { id: string }) => item.id)).toEqual(['new']);
        expect(base.skills).toHaveLength(1);
    } finally {
        await act(async () => root.unmount());
        container.remove();
        vi.unstubAllGlobals();
    }
});
