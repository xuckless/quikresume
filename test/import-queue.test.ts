import { describe, expect, it } from 'vitest';
import { importQueueTransition as reduce, selectedImportCount } from '../src/lib/import/queue';
import { emptyResumeData } from '../src/types/schema';
const file = { fileName: 'LinkedIn', data: emptyResumeData(), warnings: [] };
const start = () => reduce([], { type: 'progress', id: 'a', phase: 'processing' });
describe('LinkedIn import queue', () => {
    it('distinguishes accepting a draft from saving it and restores discarded imports', () => {
        const reviewing = reduce(reduce(start(), { type: 'parsed', id: 'a', file }), { type: 'review', id: 'a' });
        const accepted = reduce(reviewing, { type: 'accept', id: 'a', acceptedCount: 1 });
        expect(reduce(accepted, { type: 'draft-saved' })[0]).toMatchObject({ phase: 'saved', acceptedCount: 1 });
        expect(reduce(accepted, { type: 'draft-discarded' })[0]).toMatchObject({ phase: 'ready', file });
    });
    it('keeps a parse failure retryable without reviving cancelled jobs', () => {
        const failed = reduce(start(), { type: 'progress', id: 'a', phase: 'capture-error', error: 'AI unavailable' });
        expect(reduce(failed, { type: 'progress', id: 'a', phase: 'capturing' })[0].phase).toBe('capturing');
        const cancelled = reduce(failed, { type: 'cancel', id: 'a' });
        expect(reduce(cancelled, { type: 'parsed', id: 'a', file })).toBe(cancelled);
    });
    it('requires explicit review and acceptance after parsing', () => {
        const ready = reduce(start(), { type: 'parsed', id: 'a', file });
        expect(ready[0].phase).toBe('ready');
        expect(reduce(ready, { type: 'accept', id: 'a', acceptedCount: 3 })).toBe(ready);
        const reviewing = reduce(ready, { type: 'review', id: 'a' });
        expect(reduce(reviewing, { type: 'close-review', id: 'a' })[0].phase).toBe('ready');
        expect(reduce(reviewing, { type: 'accept', id: 'a', acceptedCount: 3 })[0]).toMatchObject({ phase: 'accepted', acceptedCount: 3 });
    });
    it('ignores stale completions and cleanup after ready or cancellation', () => {
        const cancelled = reduce(start(), { type: 'cancel', id: 'a' });
        expect(reduce(cancelled, { type: 'parsed', id: 'a', file })).toBe(cancelled);
        const ready = reduce(start(), { type: 'parsed', id: 'a', file });
        expect(reduce(ready, { type: 'progress', id: 'a', phase: 'cancelled' })).toBe(ready);
        expect(reduce(ready, { type: 'parsed', id: 'missing', file })).toBe(ready);
    });
    it('retains sequential jobs and rejects terminal job restarts', () => {
        const ready = reduce(start(), { type: 'parsed', id: 'a', file });
        const jobs = reduce(ready, { type: 'progress', id: 'b', phase: 'processing' });
        expect(jobs.map(j => j.phase)).toEqual(['ready', 'processing']);
        expect(reduce(jobs, { type: 'progress', id: 'a', phase: 'processing' })).toBe(jobs);
    });
    it('counts only selected list items for acceptance', () => {
        expect(selectedImportCount({ personalInfo: file.data.personalInfo, replacePersonal: false, items: { skills: [{ id: 's', category: 'Tools', items: 'TS', isSelected: true, hidden: [], tags: [], tagsHash: '' }] } })).toBe(1);
    });
});
