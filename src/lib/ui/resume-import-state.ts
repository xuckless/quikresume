import type { CombinedImport, ParsedFile } from "../import/merge";
import { combineParsedFiles } from "../import/merge";
import { emptyResumeData } from "../../types/schema";
import { MAX_FILE_BYTES } from "../import/types";

export type FileStatus = "queued" | "rendering" | "reading" | "done" | "failed";
export type QueuedFile = { file: File } & ({ status: Exclude<FileStatus, "failed"> } | { status: "failed"; error: string });
export type ImportState =
    | { step: "pick"; queue: QueuedFile[]; error: string | null }
    | { step: "working"; queue: QueuedFile[]; run: number }
    | { step: "review"; result: CombinedImport };
export type ImportEvent =
    | { type: "add"; files: File[] }
    | { type: "remove"; name: string }
    | { type: "start"; run: number }
    | { type: "progress"; run: number; index: number; status: "rendering" | "reading" | "done" }
    | { type: "failed"; run: number; index: number; error: string }
    | { type: "complete"; run: number; parsed: ParsedFile[] }
    | { type: "linkedin"; file: ParsedFile }
    | { type: "restart" };
export const initialImportState: ImportState = { step: "pick", queue: [], error: null };
export function importTransition(state: ImportState, event: ImportEvent): ImportState {
    if (event.type === "restart") return initialImportState;
    if (event.type === "linkedin") return state.step === "pick" ? { step: "review", result: combineParsedFiles([event.file], emptyResumeData()) } : state;
    if (state.step === "pick") {
        if (event.type === "remove") return { ...state, queue: state.queue.filter(q => q.file.name !== event.name) };
        if (event.type === "start") return state.queue.length ? { step: "working", run: event.run, queue: state.queue.map(q => ({ file: q.file, status: "queued" })) } : state;
        if (event.type === "add") {
            const queue = [...state.queue];
            const errors: string[] = [];
            for (const file of event.files) {
                if (queue.some(q => q.file.name === file.name && q.file.size === file.size)) continue;
                if (file.size > MAX_FILE_BYTES) { errors.push(`${file.name} is over 10 MB and was skipped.`); continue; }
                if (queue.length >= 6) { errors.push(`Only 6 files per import; ${file.name} was skipped.`); continue; }
                queue.push({ file, status: "queued" });
            }
            return { step: "pick", queue, error: errors.join(" ") || null };
        }
    }
    if (state.step !== "working" || !("run" in event) || event.run !== state.run) return state;
    if (event.type === "complete") return event.parsed.length
        ? { step: "review", result: combineParsedFiles(event.parsed, emptyResumeData()) }
        : { step: "pick", queue: state.queue, error: "None of the files could be read. See the errors next to each file." };
    if (event.type === "progress" || event.type === "failed") return { ...state, queue: state.queue.map((q, index) => index !== event.index ? q : event.type === "failed" ? { file: q.file, status: "failed", error: event.error } : { file: q.file, status: event.status }) };
    return state;
}
