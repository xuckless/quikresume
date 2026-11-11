import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), analyze: vi.fn(), auth: vi.fn(), readUserDoc: vi.fn() }));
vi.mock('@/lib/security/rate-limit', () => ({ RATE: { import: {} } }));
vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/db/user-collection', () => ({ readUserDoc: mocks.readUserDoc }));
vi.mock('@/lib/security/guard', () => ({ guardApi: mocks.guard }));
vi.mock('@/lib/import/analyze', () => ({ analyzeResume: mocks.analyze }));
import { GET, POST } from '@/app/api/import/linkedin/route';
const request = (body: unknown) => new Request('http://localhost/api/import/linkedin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); mocks.guard.mockResolvedValue({ ok: true, uid: 'user' }); mocks.analyze.mockResolvedValue(new Response('{}')); });
describe('LinkedIn text import boundary', () => {
    it('reads the saved URL for the signed-in account without exposing other profile fields', async () => {
        mocks.auth.mockResolvedValue({ user: { id: 'alice' } });
        mocks.readUserDoc.mockResolvedValue({ data: () => ({ linkedIn: 'linkedin.com/in/Alice', email: 'private@example.com' }) });
        const response = await GET();
        expect(await response.json()).toEqual({ uid: 'alice', linkedin: 'https://www.linkedin.com/in/alice' });
        expect(mocks.readUserDoc).toHaveBeenCalledWith('alice');
        expect(response.headers.get('cache-control')).toBe('no-store');
        mocks.readUserDoc.mockClear();
        mocks.auth.mockResolvedValue(null);
        expect((await GET()).status).toBe(401);
        expect(mocks.readUserDoc).not.toHaveBeenCalled();
    });
    it('requires the import guard before analysis', async () => {
        mocks.guard.mockResolvedValue({ ok: false, response: new Response('', { status: 401 }) });
        expect((await POST(request({}))).status).toBe(401);
        expect(mocks.analyze).not.toHaveBeenCalled();
    });
    it('rejects malformed, oversized and non-profile input', async () => {
        for (const body of [{}, { text: 2, url: 'https://linkedin.com/in/person' }, { text: 'x'.repeat(100001), url: 'https://linkedin.com/in/person' }, { text: 'x'.repeat(30), url: 'https://linkedin.com/in/person/details' }]) expect((await POST(request(body))).status).toBe(400);
        expect((await POST(new Request('http://localhost', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }))).status).toBe(400);
        expect(mocks.analyze).not.toHaveBeenCalled();
    });
    it('bounds request bytes without content-length', async () => {
        expect((await POST(request({ text: 'x'.repeat(405000) }))).status).toBe(413);
        expect(mocks.analyze).not.toHaveBeenCalled();
    });
    it('uses the shared guarded AI pipeline and fences untrusted text', async () => {
        await POST(request({ text: 'Profile text with untrusted instructions', url: 'https://linkedin.com/in/person' }));
        expect(mocks.guard).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ ai: true }));
        expect(mocks.analyze).toHaveBeenCalledWith('user', expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining('LINKEDIN PROFILE TEXT') })]), 'LinkedIn profile');
    });
});
