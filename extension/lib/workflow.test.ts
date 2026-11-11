import { describe, expect, it } from 'vitest';
import { transitionProfile, ownsSession, type Session } from './workflow';
import type { ProfileImport } from './types';

describe('profile transitions', () => {
    const waiting: ProfileImport = { id: 'run', url: 'https://linkedin.com/in/alice', phase: 'waiting' };
    it('rejects results before capture and duplicate capture', () => {
        expect(transitionProfile(waiting, { type: 'parsed' })).toBe(waiting);
        const capturing = transitionProfile(waiting, { type: 'capture' });
        expect(transitionProfile(capturing, { type: 'capture' })).toBe(capturing);
        expect(transitionProfile(capturing, { type: 'parsed' })).toBe(capturing);
    });
    it('retries failures and only completes after analysis', () => {
        const failed = transitionProfile(waiting, { type: 'fail', error: 'Offline' });
        const capturing = transitionProfile(failed, { type: 'capture' });
        expect(capturing).toEqual({ ...waiting, phase: 'capturing' });
        const analyzing = transitionProfile(capturing, { type: 'captured' });
        const ready = transitionProfile(analyzing, { type: 'parsed' });
        expect(ready.phase).toBe('ready');
        expect(transitionProfile(ready, { type: 'fail', error: 'Late failure' })).toBe(ready);
    });
    it('rejects cancelled and unrelated session IDs', () => {
        const pending: Session<object> = { phase: 'starting', id: 'new' };
        expect(ownsSession(pending, 'old')).toBe(false);
        expect(ownsSession(pending, 'new')).toBe(true);
        expect(ownsSession({ phase: 'idle' }, 'new')).toBe(false);
    });
});
