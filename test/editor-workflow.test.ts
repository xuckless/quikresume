import { expect, it } from 'vitest';
import { editorTransition as reduce, reReviewTransition, type EditorWorkflow } from '@/lib/ui/editor-workflow';
import { analysisDialogTransition } from '@/lib/ui/job-analysis-dialog';
it('does not reopen the analysis dialog when request cleanup follows success', () => {
    const running = analysisDialogTransition({ phase: 'editing' }, { type: 'processing' });
    expect(analysisDialogTransition(running, { type: 'close' })).toBe(running);
    const completed = analysisDialogTransition(running, { type: 'analyzed' });
    expect(analysisDialogTransition(completed, { type: 'settled' })).toBe(completed);
});
it('keeps editor confirmations exclusive and rejects stale or duplicate saves', () => {
    const editing: EditorWorkflow = { phase: 'editing' };
    const leaving = reduce(editing, { type: 'leave-request', target: '/dashboard/profile' });
    const confirmation = reduce(leaving, { type: 'variants', names: ['Work'], target: '/dashboard/profile' });
    expect(confirmation.phase).toBe('confirm-variants');
    const saving = reduce(confirmation, { type: 'save', id: 'a', target: '/dashboard/profile' });
    expect(reduce(saving, { type: 'discard-request' })).toBe(saving);
    expect(reduce(saving, { type: 'save', id: 'b', target: null })).toBe(saving);
    expect(reduce(saving, { type: 'saved', id: 'stale' })).toBe(saving);
    const failed = reduce(saving, { type: 'save-failed', id: 'a', error: 'offline' });
    expect(failed).toEqual({ phase: 'failed', error: 'offline' });
    expect(reduce(failed, { type: 'save', id: 'b', target: null }).phase).toBe('saving');
});
it('tracks re-review progress for the active operation only', () => {
    const running = reReviewTransition({ phase: 'confirming' }, { type: 'start', id: 'a' });
    expect(reReviewTransition(running, { type: 'complete', id: 'old' })).toBe(running);
    expect(reReviewTransition(running, { type: 'progress', id: 'a', reviewed: 2 })).toEqual({ phase: 'running', id: 'a', reviewed: 2 });
});
