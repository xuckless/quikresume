export type LinkedInSession = { id: string; url: string };
export type LinkedInFlow =
    | { phase: 'idle' | 'cancelled' | 'ready' }
    | { phase: 'url-required'; error?: string }
    | { phase: 'error'; error: string }
    | { phase: 'checking-extension' | 'loading-profile' | 'saving-url'; id: string }
    | ({ phase: 'opening-profile' | 'awaiting-capture' | 'capturing' | 'analyzing' } & LinkedInSession)
    | ({ phase: 'capture-error'; error: string } & LinkedInSession);

export type LinkedInEvent =
    | { type: 'start'; id: string }
    | { type: 'extension-found' | 'require-url' | 'save-url' | 'extension-started' | 'capture-started' | 'text-received' | 'parsed'; id: string }
    | { type: 'open-profile'; id: string; url: string }
    | { type: 'failed' | 'parse-failed' | 'capture-failed'; id: string; error: string }
    | { type: 'cancel' }
    | { type: 'dismiss-url' };

export function linkedInBusy(state: LinkedInFlow): boolean {
    return 'id' in state;
}

/** Every workflow edge is here; effects must identify the operation they complete. */
export function transitionLinkedIn(state: LinkedInFlow, event: LinkedInEvent): LinkedInFlow {
    if (event.type === 'cancel') return { phase: 'cancelled' };
    if (event.type === 'dismiss-url') return state.phase === 'url-required' ? { phase: 'idle' } : state;
    if (event.type === 'start') return linkedInBusy(state) ? state : { phase: 'checking-extension', id: event.id };
    if (!('id' in state) || state.id !== event.id) return state;
    switch (event.type) {
        case 'extension-found': return state.phase === 'checking-extension' ? { phase: 'loading-profile', id: state.id } : state;
        case 'require-url': return state.phase === 'loading-profile' ? { phase: 'url-required' } : state;
        case 'save-url': return state.phase === 'loading-profile' ? { phase: 'saving-url', id: state.id } : state;
        case 'open-profile': return ['loading-profile', 'saving-url'].includes(state.phase) ? { phase: 'opening-profile', id: state.id, url: event.url } : state;
        case 'extension-started': return state.phase === 'opening-profile' ? { ...state, phase: 'awaiting-capture' } : state;
        case 'capture-started': return ['awaiting-capture', 'capture-error'].includes(state.phase) && 'url' in state ? { phase: 'capturing', id: state.id, url: state.url } : state;
        case 'text-received': return ['opening-profile', 'awaiting-capture', 'capturing', 'capture-error'].includes(state.phase) && 'url' in state ? { phase: 'analyzing', id: state.id, url: state.url } : state;
        case 'parsed': return state.phase === 'analyzing' ? { phase: 'ready' } : state;
        case 'capture-failed': return ['awaiting-capture', 'capturing', 'capture-error'].includes(state.phase) && 'url' in state ? { ...state, phase: 'capture-error', error: event.error } : state;
        case 'parse-failed': return state.phase === 'analyzing' ? { ...state, phase: 'capture-error', error: event.error } : state;
        case 'failed': return state.phase === 'saving-url' ? { phase: 'url-required', error: event.error } : { phase: 'error', error: event.error };
    }
}

export function linkedInProgress(state: LinkedInFlow): { step: number; message: string } {
    switch (state.phase) {
        case 'checking-extension': return { step: 0, message: 'Checking the browser extension…' };
        case 'loading-profile': return { step: 0, message: 'Loading your saved LinkedIn URL…' };
        case 'saving-url': return { step: 0, message: 'Saving your LinkedIn URL…' };
        case 'opening-profile': return { step: 1, message: 'Opening your LinkedIn profile…' };
        case 'awaiting-capture': return { step: 1, message: 'Waiting for you: open the extension in the LinkedIn tab and click Import profile. Return to this Import tab to review the results.' };
        case 'capturing': return { step: 2, message: 'Reading your LinkedIn profile sections… Keep this Import tab open.' };
        case 'analyzing': return { step: 3, message: 'Processing your profile with AI… Next, review new items, added details, and items already in your library.' };
        case 'capture-error': return { step: 3, message: `${state.error} Retry Import profile in the extension, or cancel and start again.` };
        case 'error': return { step: 0, message: state.error };
        case 'url-required': return { step: 0, message: state.error ?? '' };
        case 'cancelled': return { step: 0, message: 'Import cancelled. No captured content was saved.' };
        case 'ready': return { step: 4, message: 'Processing complete. Review the results below before adding them to your draft.' };
        default: return { step: 0, message: '' };
    }
}
