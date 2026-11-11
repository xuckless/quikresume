import { describe, expect, it } from 'vitest';
import { canonicalProfileUrl } from './profile-url';
import { extractProfile } from './profile-extract';
describe('profile identity', () => {
    it('canonicalizes only exact profile pages', () => {
        expect(canonicalProfileUrl('https://linkedin.com/in/some-person/?trk=foo')).toBe('https://www.linkedin.com/in/some-person');
        expect(canonicalProfileUrl('https://www.linkedin.com/in/Some-Person#about')).toBe('https://www.linkedin.com/in/some-person');
        for (const url of ['https://linkedin.com.evil/in/person','https://evil@linkedin.com/in/person','http://linkedin.com/in/person','https://www.linkedin.com/in/person/details/experience','https://www.linkedin.com:444/in/person','https://www.linkedin.com/in/%2fperson','https://uk.linkedin.com/in/person']) expect(canonicalProfileUrl(url)).toBeNull();
    });
});
describe('profile capture', () => {
    const url = 'https://www.linkedin.com/in/some-person';
    it('reads a loaded profile using a main landmark and h2 name instead of h1', () => {
        document.body.innerHTML = '<div role="main"><section><h2>Jane Person</h2><p>Software Engineer at Example</p></section><section><div id="education"></div><p>Example University</p></section></div>';
        expect(extractProfile(document, url + '/', url).text).toContain('Jane Person');
    });
    it('limits capture to profile cards and warns of gaps', () => {
        document.body.innerHTML = '<nav>Chrome</nav><main><section><h1>Jane Person</h1><p>Software Engineer</p></section><section><div id="experience"></div><p>Engineer at Example</p><button>Follow</button></section><section><h2>Recommended jobs</h2><p>Unrelated content</p></section></main>';
        const capture = extractProfile(document, url, url);
        expect(capture.text).toContain('Engineer at Example');
        expect(capture.text).not.toMatch(/Chrome|Follow|Unrelated/);
        expect(capture.warnings.length).toBeGreaterThan(0);
    });
    it('rejects mismatches and login walls', () => {
        expect(() => extractProfile(document, url + '/details', url)).toThrow();
        document.body.innerHTML = '<main><h1>Sign in</h1><input type="password"></main>';
        expect(() => extractProfile(document, url, url)).toThrow(/Sign in/);
    });
});
