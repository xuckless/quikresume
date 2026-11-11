import type { ProfileImport } from './types';

export type ProfileEvent =
    | { type: 'capture' }
    | { type: 'captured' }
    | { type: 'parsed' }
    | { type: 'fail'; error: string };
/** Invalid and duplicate events preserve identity, letting callers reject stale work. */
export function transitionProfile(state: ProfileImport, event: ProfileEvent): ProfileImport {
    const base = { id: state.id, url: state.url };
    switch (event.type) {
        case 'capture': return state.phase === 'waiting' || state.phase === 'error' ? { ...base, phase: 'capturing' } : state;
        case 'captured': return state.phase === 'capturing' ? { ...base, phase: 'analyzing' } : state;
        case 'parsed': return state.phase === 'analyzing' ? { ...base, phase: 'ready' } : state;
        case 'fail': return state.phase === 'ready' ? state : { ...base, phase: 'error', error: event.error };
    }
}
export type Session<T> = { phase: 'idle' } | { phase: 'starting'; id: string } | { phase: 'active'; id: string; run: T };
export function ownsSession<T>(session: Session<T>, id: string): boolean {
    return session.phase !== 'idle' && session.id === id;
}
