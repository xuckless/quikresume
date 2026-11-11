import type { ParsedFile, ImportSelection } from './merge';
import { RESUME_LIST_KEYS } from '../../types/schema';

export type ImportProgress = { id: string; url?: string } & (
    | { phase: 'processing' | 'waiting' | 'capturing' | 'analyzing' | 'cancelled' }
    | { phase: 'error' | 'capture-error'; error: string }
);
type JobBase = { id: string; url?: string };
export type ImportJob = JobBase & (
    | { phase: 'processing' | 'waiting' | 'capturing' | 'analyzing' | 'cancelled' }
    | { phase: 'error' | 'capture-error'; error: string }
    | { phase: 'ready' | 'reviewing'; file: ParsedFile }
    | { phase: 'accepted'; acceptedCount: number; file: ParsedFile }
    | { phase: 'saved'; acceptedCount: number }
);
export type ImportQueueEvent =
    | ({ type: 'progress' } & ImportProgress)
    | { type: 'parsed'; id: string; file: ParsedFile }
    | { type: 'review' | 'close-review' | 'cancel'; id: string }
    | { type: 'accept'; id: string; acceptedCount: number }
    | { type: 'draft-saved' | 'draft-discarded' };
export const initialImportQueue: ImportJob[] = [];
const active = (job: ImportJob) => ['processing', 'waiting', 'capturing', 'analyzing', 'capture-error'].includes(job.phase);
export function importQueueTransition(state: ImportJob[], event: ImportQueueEvent): ImportJob[] {
    if (event.type === 'draft-saved') return state.map(job => job.phase === 'accepted' ? { id: job.id, url: job.url, phase: 'saved', acceptedCount: job.acceptedCount } : job);
    if (event.type === 'draft-discarded') return state.map(job => job.phase === 'accepted' ? { id: job.id, url: job.url, phase: 'ready', file: job.file } : job);
    if (!('id' in event)) return state;
    const job = state.find(j => j.id === event.id);
    if (!job) return event.type === 'progress' && event.phase === 'processing'
        ? [...state, { id: event.id, url: event.url, phase: 'processing' }] : state;
    let next: ImportJob;
    if (event.type === 'progress' && active(job)) {
        next = event.phase === 'error' || event.phase === 'capture-error' ? { id: job.id, url: event.url ?? job.url, phase: event.phase, error: event.error }
            : { id: job.id, url: event.url ?? job.url, phase: event.phase };
    } else if (event.type === 'parsed' && active(job)) next = { id: job.id, url: job.url, phase: 'ready', file: event.file };
    else if (event.type === 'review' && job.phase === 'ready') next = { ...job, phase: 'reviewing' };
    else if (event.type === 'close-review' && job.phase === 'reviewing') next = { ...job, phase: 'ready' };
    else if (event.type === 'accept' && job.phase === 'reviewing') next = { id: job.id, url: job.url, phase: 'accepted', acceptedCount: Math.max(0, event.acceptedCount), file: job.file };
    else if (event.type === 'cancel' && active(job)) next = { id: job.id, url: job.url, phase: 'cancelled' };
    else return state;
    return state.map(j => j.id === event.id ? next : j);
}
export function selectedImportCount(selection: ImportSelection): number {
    return RESUME_LIST_KEYS.reduce((count, key) => count + (selection.items[key]?.length ?? 0), 0);
}
