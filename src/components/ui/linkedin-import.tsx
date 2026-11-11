"use client";

import { motion, useReducedMotion } from 'motion/react';
import { useMotionPresets } from '@/lib/ui/motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { canonicalProfileUrl } from '@/lib/import/linkedin';
import { linkedInBusy, linkedInProgress, transitionLinkedIn, type LinkedInEvent, type LinkedInFlow } from '@/lib/import/linkedin-flow';
import { APP_SOURCE, EXT_SOURCE, detectProfileExtension } from '@/lib/ext/bridge';
import { saveLinkedInUrl } from '@/app/actions/user-actions';
import type { ImportResponse } from '@/lib/import/types';
import type { ParsedFile } from '@/lib/import/merge';
import type { ImportProgress } from '@/lib/import/queue';
import { Button } from './primitives/button';
import { Dialog } from './primitives/dialog';

const post = (data: object) => window.postMessage({ source: APP_SOURCE, ...data }, location.origin);
const STEPS = ['Connect', 'Confirm in extension', 'Capture profile', 'Process content', 'Review results'];

export function LinkedInImport({ url, onSavedUrl, onParsed, onProgress }: { url: string; onSavedUrl: (url: string) => void; onParsed: (file: ParsedFile, meta: { id: string }) => void; onProgress?: (progress: ImportProgress) => void }) {
    const transitions = useMotionPresets();
    const reducedMotion = useReducedMotion();
    const [value, setValue] = useState(url);
    const [flow, setFlow] = useState<LinkedInFlow>({ phase: 'idle' });
    // The same state drives rendering and synchronous extension event handling.
    const current = useRef<LinkedInFlow>(flow);
    const resources = useRef<{ abort?: AbortController; handshake?: ReturnType<typeof setTimeout> }>({});
    const progressCallback = useRef(onProgress);
    useEffect(() => { progressCallback.current = onProgress; }, [onProgress]);
    const send = useCallback((event: LinkedInEvent) => {
        const previous = current.current;
        const next = transitionLinkedIn(previous, event);
        current.current = next;
        setFlow(next);
        const id = 'id' in next ? next.id : 'id' in previous ? previous.id : null;
        if (next !== previous && id) {
            const context = { id, ...('url' in next ? { url: next.url } : 'url' in previous ? { url: previous.url } : {}) };
            switch (next.phase) {
                case 'checking-extension': case 'loading-profile': case 'saving-url': progressCallback.current?.({ ...context, phase: 'processing' }); break;
                case 'opening-profile': case 'awaiting-capture': progressCallback.current?.({ ...context, phase: 'waiting' }); break;
                case 'capturing': case 'analyzing': progressCallback.current?.({ ...context, phase: next.phase }); break;
                case 'capture-error': progressCallback.current?.({ ...context, phase: 'capture-error', error: next.error }); break;
                case 'error': progressCallback.current?.({ ...context, phase: 'error', error: next.error }); break;
                case 'cancelled': case 'url-required': progressCallback.current?.({ ...context, phase: 'cancelled' }); break;
            }
        }
        return next;
    }, []);
    const matchesOperation = (id: string) => 'id' in current.current && current.current.id === id;
    const stopEffects = () => {
        resources.current.abort?.abort();
        clearTimeout(resources.current.handshake);
        resources.current = {};
    };
    const cancel = () => {
        const state = current.current;
        send({ type: 'cancel' });
        stopEffects();
        if ('id' in state) post({ type: 'profile-cancel', id: state.id });
    };

    useEffect(() => {
        const listener = async (e: MessageEvent) => {
            if (e.source !== window || e.origin !== location.origin || e.data?.source !== EXT_SOURCE) return;
            const d = e.data;
            const state = current.current;
            if (!('id' in state) || (d.id !== state.id && !(d.type === 'profile-error' && d.id === undefined))) return;
            const id = state.id;
            if (d.type === 'profile-capture-error') {
                send({ type: 'capture-failed', id, error: typeof d.error === 'string' ? d.error : 'Could not capture your profile.' });
                return;
            }
            if (d.type === 'profile-error') {
                stopEffects();
                send({ type: 'failed', id, error: typeof d.error === 'string' ? d.error : 'The extension disconnected. Start the import again.' });
                return;
            }
            if (d.type === 'profile-started') {
                clearTimeout(resources.current.handshake);
                send({ type: 'extension-started', id });
                return;
            }
            if (d.type === 'profile-progress' && d.phase === 'capturing') {
                send({ type: 'capture-started', id });
                return;
            }
            if (d.type !== 'profile-text' || !('url' in state) || typeof d.text !== 'string' || d.text.length > 100_000 || typeof d.url !== 'string' || canonicalProfileUrl(d.url) !== state.url) return;
            const next = send({ type: 'text-received', id });
            if (state.phase === 'analyzing' || next.phase !== 'analyzing') return;
            clearTimeout(resources.current.handshake);
            const abort = new AbortController();
            resources.current.abort = abort;
            const timeout = setTimeout(() => abort.abort(), 150_000);
            try {
                const response = await fetch('/api/import/linkedin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: d.text, url: d.url }), signal: abort.signal });
                const result: ImportResponse = await response.json();
                if (!matchesOperation(id)) return;
                if (!result.ok) throw new Error(result.error);
                const warnings: string[] = Array.isArray(d.warnings) ? d.warnings.filter((w: unknown): w is string => typeof w === 'string').slice(0, 10) : [];
                result.data.personalInfo.linkedin = state.url;
                send({ type: 'parsed', id });
                post({ type: 'profile-result', id, ok: true });
                onParsed({ fileName: result.fileName, data: result.data, warnings: [...result.warnings, ...warnings] }, { id });
            } catch (err) {
                if (!matchesOperation(id)) return;
                const error = err instanceof Error ? err.message : 'Import failed.';
                send({ type: 'parse-failed', id, error });
                post({ type: 'profile-result', id, ok: false, error });
            } finally { clearTimeout(timeout); }
        };
        window.addEventListener('message', listener);
        return () => {
            window.removeEventListener('message', listener);
            stopEffects();
            const state = current.current;
            current.current = { phase: 'cancelled' };
            if ('id' in state) {
                progressCallback.current?.({ id: state.id, phase: 'cancelled' });
                post({ type: 'profile-cancel', id: state.id });
            }
        };
    }, [onParsed, send]);

    const start = async () => {
        if (linkedInBusy(current.current)) return;
        const id = crypto.randomUUID();
        send({ type: 'start', id });
        try {
            const extension = await detectProfileExtension();
            if (!matchesOperation(id)) return;
            if (!extension || !extension.paired || !extension.profileImport) {
                send({ type: 'cancel' });
                const reason = !extension ? 'missing' : !extension.profileImport ? 'update' : 'pair';
                location.assign('/dashboard/extension?reason=' + reason);
                return;
            }
            send({ type: 'extension-found', id });
            const response = await fetch('/api/import/linkedin', { cache: 'no-store' });
            const identity = await response.json();
            if (!matchesOperation(id)) return;
            if (!response.ok || typeof identity.uid !== 'string') throw new Error('Sign in to the website again.');
            const storedUrl = typeof identity.linkedin === 'string' ? canonicalProfileUrl(identity.linkedin) : null;
            const candidate = value.trim() || url.trim();
            if (!storedUrl && !candidate) { send({ type: 'require-url', id }); return; }
            let saved = storedUrl;
            if (!saved) {
                send({ type: 'save-url', id });
                saved = await saveLinkedInUrl(candidate);
                if (!matchesOperation(id)) return;
            }
            setValue(saved);
            onSavedUrl(saved);
            send({ type: 'open-profile', id, url: saved });
            post({ type: 'profile-start', id, uid: identity.uid, url: saved });
            resources.current.handshake = setTimeout(() => {
                if (current.current.phase !== 'opening-profile' || current.current.id !== id) return;
                send({ type: 'failed', id, error: 'The extension did not answer. Reload the extension and website, then retry.' });
                post({ type: 'profile-cancel', id });
            }, 10_000);
        } catch (err) {
            if (matchesOperation(id)) send({ type: 'failed', id, error: err instanceof Error ? err.message : 'Could not start. Try again.' });
        }
    };

    const busy = linkedInBusy(flow);
    const progress = linkedInProgress(flow);
    const failed = flow.phase === 'error' || flow.phase === 'capture-error' || (flow.phase === 'url-required' && Boolean(flow.error));
    return <section aria-label="LinkedIn import" className="space-y-3 rounded-lg border border-border p-4">
        <h3 className="flex items-center gap-3 text-sm font-medium"><svg aria-hidden="true" viewBox="0 0 24 24" className="size-7 shrink-0 rounded text-[#0a66c2]" fill="currentColor"><path d="M20.45 2H3.55C2.69 2 2 2.68 2 3.52v16.96c0 .84.69 1.52 1.55 1.52h16.9c.86 0 1.55-.68 1.55-1.52V3.52c0-.84-.69-1.52-1.55-1.52ZM7.93 18.75H4.98V9.2h2.95v9.55ZM6.45 7.9a1.71 1.71 0 1 1 0-3.42 1.71 1.71 0 0 1 0 3.42Zm12.3 10.85H15.8v-4.64c0-1.11-.02-2.54-1.55-2.54-1.55 0-1.79 1.21-1.79 2.46v4.72H9.51V9.2h2.83v1.3h.04c.39-.74 1.36-1.53 2.8-1.53 3 0 3.57 1.97 3.57 4.53v5.25Z" /></svg>Import from LinkedIn</h3>
        <p className="text-sm text-fg-muted">Capture your own profile, review what is new or already present, then add chosen items to your editor draft. Save &amp; Exit keeps them. Your profile text is sent to our AI provider; the profile URL saves immediately.</p>
        {url && <p className="break-all text-sm">{url}</p>}
        <Button disabled={busy} onClick={() => void start()}>Queue LinkedIn import</Button>
        {busy && <>
            <ol aria-label="LinkedIn import progress" className="flex flex-wrap gap-x-4 gap-y-1 text-13">
                {STEPS.map((label, index) => <motion.li initial={{ opacity: 0, y: reducedMotion ? 0 : 4 }} animate={{ opacity: 1, y: 0 }} transition={{ ...transitions.pop, delay: reducedMotion ? 0 : index * 0.03 }} key={label} aria-current={index === progress.step ? 'step' : undefined} className={index <= progress.step ? 'font-medium text-fg' : 'text-fg-subtle'}>{index < progress.step ? '✓ ' : `${index + 1}. `}{label}</motion.li>)}
            </ol>
            <p className="text-sm text-fg-muted">Results will appear here in the Import tab. Nothing captured is saved until you review and Save &amp; Exit.</p>
            <Button variant="ghost" onClick={cancel}>Cancel LinkedIn import</Button>
        </>}
        {progress.message && <p role={failed ? 'alert' : 'status'} className={failed ? 'text-sm text-danger' : 'text-sm'}>{progress.message}</p>}
        <Dialog open={flow.phase === 'url-required' || flow.phase === 'saving-url'} onClose={() => send({ type: 'dismiss-url' })} title="Your LinkedIn profile" description="Save your own LinkedIn profile URL to continue." footer={<Button disabled={busy} onClick={() => void start()}>Save URL and continue</Button>}>
            <input aria-label="Your LinkedIn profile URL" className="w-full rounded border border-border p-2" value={value} disabled={busy} onChange={e => setValue(e.target.value)} placeholder="https://www.linkedin.com/in/your-name" />
            {flow.phase === 'url-required' && flow.error && <p role="alert">{flow.error}</p>}
        </Dialog>
    </section>;
}
