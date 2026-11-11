import { expect, it } from 'vitest';
import { pairingTransition as reduce } from '@/lib/ext/pairing-flow';
it('ignores stale code completion after pairing succeeded', () => {
    const issuing = reduce({ phase: 'idle' }, { type: 'issue', id: 'a', mode: 'automatic' });
    const connected = reduce(issuing, { type: 'paired', ok: true });
    expect(reduce(connected, { type: 'code', id: 'a', code: { code: 'ABCD', expiresAt: 'soon' } })).toBe(connected);
});
it('keeps the manual fallback code after an extension pairing error', () => {
    const issuing = reduce({ phase: 'idle' }, { type: 'issue', id: 'a', mode: 'manual' });
    const awaiting = reduce(issuing, { type: 'code', id: 'a', code: { code: 'ABCD', expiresAt: 'soon' } });
    const failed = reduce(awaiting, { type: 'paired', ok: false, error: 'offline' });
    expect(failed.phase).toBe('pairing-failed');
    expect(reduce(failed, { type: 'dismiss' })).toEqual(awaiting);
});
