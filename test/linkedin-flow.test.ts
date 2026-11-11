import { describe, expect, it } from 'vitest';
import { transitionLinkedIn as reduce, type LinkedInFlow } from '@/lib/import/linkedin-flow';

function waiting(): LinkedInFlow {
    let state: LinkedInFlow = { phase: 'idle' };
    state = reduce(state, { type: 'start', id: 'a' });
    state = reduce(state, { type: 'extension-found', id: 'a' });
    state = reduce(state, { type: 'open-profile', id: 'a', url: 'https://www.linkedin.com/in/alice' });
    return reduce(state, { type: 'extension-started', id: 'a' });
}
describe('LinkedIn workflow', () => {
    it('requires capture and analysis before review readiness', () => {
        const state = waiting();
        expect(reduce(state, { type: 'parsed', id: 'a' })).toBe(state);
        const capturing = reduce(state, { type: 'capture-started', id: 'a' });
        expect(capturing.phase).toBe('capturing');
        const parsing = reduce(capturing, { type: 'text-received', id: 'a' });
        expect(parsing.phase).toBe('analyzing');
        expect(reduce(parsing, { type: 'text-received', id: 'a' })).toBe(parsing);
        expect(reduce(parsing, { type: 'parsed', id: 'a' }).phase).toBe('ready');
    });
    it('rejects stale completions after cancellation and a new start', () => {
        const cancelled = reduce(waiting(), { type: 'cancel' });
        expect(reduce(cancelled, { type: 'text-received', id: 'a' })).toBe(cancelled);
        const restarted = reduce(cancelled, { type: 'start', id: 'b' });
        expect(reduce(restarted, { type: 'failed', id: 'a', error: 'late' })).toBe(restarted);
    });
    it('keeps a failed parse retryable within the same session', () => {
        const parsing = reduce(waiting(), { type: 'text-received', id: 'a' });
        const failed = reduce(parsing, { type: 'parse-failed', id: 'a', error: 'Unavailable' });
        expect(failed.phase).toBe('capture-error');
        expect(reduce(failed, { type: 'capture-started', id: 'a' }).phase).toBe('capturing');
    });
});
