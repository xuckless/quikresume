// src/lib/import/import-flow.ts
// The Import view's flow (components/ui/resume-import.tsx): pick files -> working (one file at a time,
// driven by an effect keyed on the run id and the next file's index) -> review. A finished LinkedIn
// session enters the same review through the "linkedin" event. Results from an older run are ignored.

import { combineParsedFiles, type CombinedImport, type ParsedFile } from "./merge";
import { MAX_FILE_BYTES } from "./types";
import { emptyResumeData } from "@/types/schema";

export const MAX_FILES = 6;

export type FileStatus = "queued" | "rendering" | "reading" | "done" | "failed";
export type QueuedFile =
    | { file: File; status: "queued" | "rendering" | "reading" }
    | { file: File; status: "done"; parsed: ParsedFile }
    | { file: File; status: "failed"; error: string };

export type ImportState =
    | { step: "pick"; queue: QueuedFile[]; error: string | null }
    | { step: "working"; run: string; queue: QueuedFile[] }
    | { step: "review"; result: CombinedImport };

export type ImportEvent =
    | { type: "add"; files: File[] }
    | { type: "remove"; name: string }
    | { type: "start"; run: string }
    | { type: "file-status"; run: string; index: number; status: "rendering" | "reading" }
    | { type: "file-done"; run: string; index: number; parsed: ParsedFile }
    | { type: "file-failed"; run: string; index: number; error: string }
    | { type: "linkedin"; file: ParsedFile }
    | { type: "restart" };

export const initialImportState: ImportState = { step: "pick", queue: [], error: null };

/** Index of the file the working run handles now, or -1. */
export function currentFileIndex(state: ImportState): number {
    if (state.step !== "working") return -1;
    return state.queue.findIndex(q => q.status === "queued" || q.status === "rendering" || q.status === "reading");
}

function addFiles(queue: QueuedFile[], files: File[]): ImportState {
    const next = [...queue];
    const errors: string[] = [];
    for (const file of files) {
        if (next.some(q => q.file.name === file.name && q.file.size === file.size)) continue;
        if (file.size > MAX_FILE_BYTES) { errors.push(`${file.name} is over 10 MB and was skipped.`); continue; }
        if (next.length >= MAX_FILES) { errors.push(`Only ${MAX_FILES} files per import; ${file.name} was skipped.`); continue; }
        next.push({ file, status: "queued" });
    }
    return { step: "pick", queue: next, error: errors.join(" ") || null };
}

/** After a file finishes: keep working, or move to review (or back to pick when nothing was read). */
function settle(run: string, queue: QueuedFile[]): ImportState {
    if (queue.some(q => q.status === "queued" || q.status === "rendering" || q.status === "reading")) return { step: "working", run, queue };
    const parsed = queue.flatMap(q => (q.status === "done" ? [q.parsed] : []));
    if (parsed.length === 0) return { step: "pick", queue, error: "None of the files could be read. See the error next to each file." };
    return { step: "review", result: combineParsedFiles(parsed, emptyResumeData()) };
}

export function importReducer(state: ImportState, event: ImportEvent): ImportState {
    switch (event.type) {
        case "restart":
            return initialImportState;
        case "linkedin":
            return state.step === "pick" ? { step: "review", result: combineParsedFiles([event.file], emptyResumeData()) } : state;
        case "add":
            return state.step === "pick" ? addFiles(state.queue, event.files) : state;
        case "remove":
            return state.step === "pick" ? { ...state, queue: state.queue.filter(q => q.file.name !== event.name), error: null } : state;
        case "start":
            if (state.step !== "pick" || state.queue.length === 0) return state;
            return { step: "working", run: event.run, queue: state.queue.map(q => ({ file: q.file, status: "queued" })) };
    }
    if (state.step !== "working" || event.run !== state.run || event.index !== currentFileIndex(state)) return state;
    const queue = [...state.queue];
    const file = queue[event.index].file;
    switch (event.type) {
        case "file-status":
            queue[event.index] = { file, status: event.status };
            return { ...state, queue };
        case "file-done":
            queue[event.index] = { file, status: "done", parsed: event.parsed };
            return settle(state.run, queue);
        case "file-failed":
            queue[event.index] = { file, status: "failed", error: event.error };
            return settle(state.run, queue);
    }
}
