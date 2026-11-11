export type AnalysisDialog = { phase: 'closed' | 'editing' | 'processing' };
export type AnalysisDialogEvent = { type: 'open' | 'close' | 'processing' | 'settled' | 'analyzed' };
export function analysisDialogTransition(state: AnalysisDialog, event: AnalysisDialogEvent): AnalysisDialog {
    switch (event.type) {
        case 'open': return state.phase === 'closed' ? { phase: 'editing' } : state;
        case 'close': return state.phase === 'editing' ? { phase: 'closed' } : state;
        case 'processing': return state.phase === 'editing' ? { phase: 'processing' } : state;
        case 'settled': return state.phase === 'processing' ? { phase: 'editing' } : state;
        case 'analyzed': return state.phase === 'processing' ? { phase: 'closed' } : state;
    }
}
