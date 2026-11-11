export type ConnectionCode = { code: string; expiresAt: string };
export type PairingFlow =
    | { phase: 'idle' | 'connected' }
    | { phase: 'issuing'; id: string; mode: 'automatic' | 'manual' }
    | { phase: 'awaiting'; id: string; code: ConnectionCode }
    | { phase: 'pairing-failed'; id: string; code: ConnectionCode; error: string }
    | { phase: 'failed'; error: string };
export type PairingEvent =
    | { type: 'issue'; id: string; mode: 'automatic' | 'manual' }
    | { type: 'code'; id: string; code: ConnectionCode }
    | { type: 'failed'; id: string; error: string }
    | { type: 'paired'; ok: boolean; error?: string }
    | { type: 'dismiss' };
export function pairingTransition(state: PairingFlow, event: PairingEvent): PairingFlow {
    switch (event.type) {
        case 'issue': return state.phase === 'issuing' ? state : { phase: 'issuing', id: event.id, mode: event.mode };
        case 'code': return state.phase === 'issuing' && state.id === event.id ? { phase: 'awaiting', id: state.id, code: event.code } : state;
        case 'failed': return state.phase === 'issuing' && state.id === event.id ? { phase: 'failed', error: event.error } : state;
        case 'paired': {
            if (!['issuing', 'awaiting', 'pairing-failed'].includes(state.phase)) return state;
            if (event.ok) return { phase: 'connected' };
            const error = event.error ?? 'The extension could not connect. Try the code in its panel.';
            return 'code' in state ? { ...state, phase: 'pairing-failed', error } : { phase: 'failed', error };
        }
        case 'dismiss': return state.phase === 'issuing' ? state : state.phase === 'pairing-failed' ? { phase: 'awaiting', id: state.id, code: state.code } : { phase: 'idle' };
    }
}

export type ExtensionDetection = { phase: 'checking' | 'missing' } | { phase: 'found'; version: string; paired: boolean };
