export type EditorWorkflow =
    | { phase: 'editing' | 'confirm-discard' }
    | { phase: 'confirm-leave'; target: string }
    | { phase: 'confirm-variants'; names: string[]; target: string | null }
    | { phase: 'saving'; id: string; target: string | null }
    | { phase: 'failed'; error: string };
export type EditorEvent =
    | { type: 'reset' | 'discard-request' }
    | { type: 'leave-request'; target: string }
    | { type: 'variants'; names: string[]; target: string | null }
    | { type: 'save'; id: string; target: string | null }
    | { type: 'saved'; id: string }
    | { type: 'save-failed'; id: string; error: string }
    | { type: 'error'; error: string };
export function editorTransition(state: EditorWorkflow, event: EditorEvent): EditorWorkflow {
    if (state.phase === 'saving') {
        if (event.type === 'saved' && event.id === state.id) return { phase: 'editing' };
        if (event.type === 'save-failed' && event.id === state.id) return { phase: 'failed', error: event.error };
        return state;
    }
    switch (event.type) {
        case 'reset': return { phase: 'editing' };
        case 'discard-request': return { phase: 'confirm-discard' };
        case 'leave-request': return { phase: 'confirm-leave', target: event.target };
        case 'variants': return { phase: 'confirm-variants', names: event.names, target: event.target };
        case 'save': return { phase: 'saving', id: event.id, target: event.target };
        case 'error': return { phase: 'failed', error: event.error };
        default: return state;
    }
}

export type ReReviewWorkflow = { phase: 'idle' | 'confirming' } | { phase: 'running'; id: string; reviewed: number };
export type ReReviewEvent = { type: 'confirm' | 'cancel' } | { type: 'start'; id: string } | { type: 'progress'; id: string; reviewed: number } | { type: 'complete'; id: string };
export function reReviewTransition(state: ReReviewWorkflow, event: ReReviewEvent): ReReviewWorkflow {
    if (state.phase === 'running') {
        if (event.type === 'progress' && state.id === event.id) return { ...state, reviewed: state.reviewed + event.reviewed };
        if (event.type === 'complete' && state.id === event.id) return { phase: 'idle' };
        return state;
    }
    if (event.type === 'confirm') return { phase: 'confirming' };
    if (event.type === 'cancel') return { phase: 'idle' };
    if (event.type === 'start' && state.phase === 'confirming') return { phase: 'running', id: event.id, reviewed: 0 };
    return state;
}
