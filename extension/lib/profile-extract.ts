import { canonicalProfileUrl } from './profile-url';
const MAIN = 'main, [role="main"], .scaffold-layout__main';
const HEADING = 'h1, h2, [role="heading"][aria-level="1"], [role="heading"][aria-level="2"]';
export function profileAvailability(doc: Document) {
    const loginWall = Boolean(doc.querySelector('input[type="password"], form[action*="login"], .authwall'));
    return { ready: !loginWall && Boolean(doc.querySelector(MAIN)?.querySelector(HEADING)), loginWall };
}
export function extractProfile(doc: Document, currentUrl: string, expectedUrl: string) {
    if (!canonicalProfileUrl(expectedUrl) || canonicalProfileUrl(currentUrl) !== canonicalProfileUrl(expectedUrl)) throw new Error('Open the exact saved profile URL before importing.');
    if (profileAvailability(doc).loginWall) throw new Error('Sign in to LinkedIn manually, then retry.');
    const main = doc.querySelector(MAIN);
    if (!main?.querySelector(HEADING)) throw new Error('Profile content has not loaded or its layout is unsupported. Wait for the profile and retry.');
    const copy = main.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('nav, aside, button, script, style, [aria-hidden="true"], .artdeco-card__actions, .pvs-profile-actions').forEach(e => e.remove());
    // Select profile cards only; avoid recommendations and the global page feed.
    const supported = new Set(['about','experience','education','skills','projects','licenses_and_certifications','honors_and_awards','volunteering_experience','publications','languages','organizations','courses','patents','test_scores']);
    const identity = copy.querySelector(HEADING);
    const cards = Array.from(copy.querySelectorAll('section, article')).filter(s => (identity && s.contains(identity)) || supported.has(s.id) || Array.from(s.querySelectorAll('[id]')).some(e => supported.has(e.id)));
    if (!cards.length) throw new Error('No supported profile sections found. LinkedIn may have changed; retry after loading your profile.');
    copy.querySelectorAll('a[href]').forEach(a => { try { const u = new URL(a.getAttribute('href') ?? ''); if (u.protocol === 'https:' && !u.hostname.endsWith('linkedin.com')) a.append(` (${u.href})`); } catch { /* Relative UI links are omitted. */ } });
    copy.querySelectorAll('p, li, div, h1, h2, h3, br').forEach(e => e.append('\n'));
    const text = cards.map(s => (s.textContent ?? '').replace(/[ \t]+/g,' ').trim()).join('\n\n');
    if (text.length < 20) throw new Error('Profile content is empty. Retry after it loads.');
    if (text.length > 100_000) throw new Error('Profile is too large. Nothing was sent.');
    return { text, warnings: ['Only visible inline profile content was captured. Hidden sections, contact dialogs and detail pages may be missing; check all sections before saving.'] };
}
export async function captureProfile(expected: string) {
    if (canonicalProfileUrl(location.href) !== canonicalProfileUrl(expected)) throw new Error('Profile URL mismatch.');
    if (profileAvailability(document).loginWall) throw new Error('Sign in manually, then retry.');
    for (let i = 0; i < 12; i++) {
        window.scrollBy(0, window.innerHeight);
        await new Promise(r => setTimeout(r, 200));
        document.querySelector(MAIN)?.querySelectorAll<HTMLButtonElement>('button[aria-expanded="false"]').forEach(b => {
            if (/see more|show more/i.test(b.textContent ?? '') && !b.closest('aside')) b.click();
        });
    }
    const result = extractProfile(document, location.href, expected);
    if (canonicalProfileUrl(location.href) !== canonicalProfileUrl(expected)) throw new Error('Profile changed during capture. Retry.');
    return result;
}
