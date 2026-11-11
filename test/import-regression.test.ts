import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), chat: vi.fn() }));
vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/security/rate-limit', () => ({ RATE: { import: {} } }));
vi.mock('@/lib/security/guard', () => ({ guardApi: mocks.guard }));
vi.mock('@/lib/security/ai-budget', () => ({ withAiUser: (_uid: string, _feature: string, run: () => unknown) => run() }));
vi.mock('@/lib/glm/client', () => ({ chatCompletion: mocks.chat, GlmError: class extends Error {}, glmErrorStatus: () => 502, glmModel: () => 'test', isGlmConfigured: () => true }));
import { POST as fileImport } from '@/app/api/import/route';
import { POST as linkedinImport } from '@/app/api/import/linkedin/route';
import { combineParsedFiles, mergeImport } from '@/lib/import/merge';
import { emptyResumeData } from '@/types/schema';

beforeEach(() => {
    vi.clearAllMocks();
    mocks.guard.mockResolvedValue({ ok: true, uid: 'alice' });
    mocks.chat.mockResolvedValue({ model: 'test', text: JSON.stringify({
        personalInfo: { firstName: 'Alice', linkedin: 'https://www.linkedin.com/in/alice' },
        skills: [{ category: 'Programming', items: ['TypeScript', 'React'] }],
    }) });
});

describe('file and LinkedIn shared import regression', () => {
    it('parses both sources into the same review shape and merges without mutating the saved base', async () => {
        const form = new FormData();
        form.append('file', new File(['Alice\nProgramming: TypeScript, React'], 'resume.txt', { type: 'text/plain' }));
        const uploaded = await fileImport(new Request('http://localhost/api/import', { method: 'POST', body: form }));
        const captured = await linkedinImport(new Request('http://localhost/api/import/linkedin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://www.linkedin.com/in/alice', text: 'Alice\nProgramming: TypeScript, React' }) }));
        expect(uploaded.status).toBe(200);
        expect(captured.status).toBe(200);
        const files = await Promise.all([uploaded.json(), captured.json()]);
        for (const file of files) {
            expect(file.ok).toBe(true);
            expect(file.data.personalInfo.firstName).toBe('Alice');
            expect(file.data.skills[0].items).toBe('TypeScript, React');
        }
        const review = combineParsedFiles(files, emptyResumeData());
        expect(review.fileNames).toEqual(['resume.txt', 'LinkedIn profile']);
        expect(review.data.skills).toHaveLength(1);
        const base = emptyResumeData();
        base.personalInfo.linkedin = 'https://www.linkedin.com/in/alice';
        const before = JSON.stringify(base);
        const draft = mergeImport(base, { personalInfo: review.data.personalInfo, replacePersonal: false, items: { skills: review.data.skills } });
        expect(draft.added).toBe(1);
        expect(draft.data.personalInfo.linkedin).toBe(base.personalInfo.linkedin);
        expect(JSON.stringify(base)).toBe(before);
        expect(mergeImport(draft.data, { personalInfo: null, replacePersonal: false, items: { skills: review.data.skills } }).unchanged).toBe(1);
    });
});
