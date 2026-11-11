import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXT_SOURCE, isExtMessage } from '@/lib/ext/bridge';
afterEach(() => vi.unstubAllGlobals());
describe('extension page bridge', () => {
    it('accepts validated messages only from the current window and origin', () => {
        const win = { location: { origin: 'https://app.example' } };
        vi.stubGlobal('window', win);
        const data = { source: EXT_SOURCE, type: 'hello', paired: true, version: '0.1.0' };
        const event = (patch: object) => ({ source: win, origin: win.location.origin, data, ...patch }) as unknown as MessageEvent;
        expect(isExtMessage(event({}))).toBe(true);
        expect(isExtMessage(event({ source: {} }))).toBe(false);
        expect(isExtMessage(event({ origin: 'https://evil.example' }))).toBe(false);
        expect(isExtMessage(event({ data: { ...data, paired: 'true' } }))).toBe(false);
        expect(isExtMessage(event({ data: { source: EXT_SOURCE, type: 'unknown' } }))).toBe(false);
        expect(isExtMessage(event({ data: null }))).toBe(false);
    });
});
