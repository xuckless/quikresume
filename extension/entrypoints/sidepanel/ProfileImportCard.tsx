import { useEffect, useState } from 'react';
import type { TabState } from '../../lib/types';
import { canonicalProfileUrl } from '../../lib/profile-url';
export function ProfileImportCard({ state, tabId }: { state: NonNullable<TabState['profileImport']>; tabId: number }) {
    const [url, setUrl] = useState('');
    const [probe, setProbe] = useState<'unknown' | 'checking' | 'ready' | 'login-required'>('unknown');
    const [error, setError] = useState('');
    useEffect(() => {
        const read = () => {
            void chrome.tabs.get(tabId).then(t => setUrl(t.url ?? '')).catch(() => setUrl(''));
            void chrome.tabs.sendMessage(tabId, { type: 'profile-availability' }).then(r => setProbe(r?.loginWall === true ? 'login-required' : r?.ready === true ? 'ready' : 'unknown')).catch(() => setProbe('unknown'));
        };
        read();
        const changed = (id: number) => { if (id === tabId) read(); };
        const timer = setInterval(read, 1500);
        chrome.tabs.onUpdated.addListener(changed);
        return () => { clearInterval(timer); chrome.tabs.onUpdated.removeListener(changed); };
    }, [tabId]);
    const currentUrl = canonicalProfileUrl(url);
    const matches = currentUrl !== null && currentUrl === canonicalProfileUrl(state.url);
    return <div className="card stack">
        <h2>LinkedIn profile import</h2>
        <p>Expected: {state.url}</p><p>Current: {currentUrl ?? (url || 'Loading…')}</p>
        {matches && <p>Profile URL matches.</p>}
        {state.phase === 'ready' ? <><div style={{ fontSize: 80, color: 'var(--accent-text)', textAlign: 'center' }} aria-label="Review ready">✓</div><p>Import queued on quikResume. Return to the website’s Import tab, open Review import, and accept the items you want. Save &amp; Exit keeps them in your library.</p></> : <>
            <p>Sign in manually. Only inline sections are read; review for gaps. Matching the URL does not prove ownership.</p>
            {url && !matches && <p role="alert" className="err">This tab is not the LinkedIn profile you saved in quikResume. Open the expected profile above.</p>}
            {matches && probe === 'login-required' && <p role="alert" className="err">Log into LinkedIn, then return to your profile.</p>}
            {matches && probe !== 'login-required' && probe !== 'ready' && <p>Page readiness could not be confirmed. If your profile is visible, click Import profile to retry capture.</p>}
            {state.error && <p role="alert" className="err">{state.error}</p>}
            {error && <p role="alert" className="err">{error}</p>}
            <button className="btn primary block" disabled={!matches || probe === 'login-required' || !['waiting','error'].includes(state.phase)} onClick={() => { setError(''); void chrome.runtime.sendMessage({ type: 'profile-capture', tabId }).catch(() => setError('Extension disconnected. Restart import from the website.')); }}>{state.phase === 'capturing' ? 'Capturing…' : state.phase === 'analyzing' ? 'AI analysis…' : 'Import profile'}</button>
        </>}
    </div>;
}
