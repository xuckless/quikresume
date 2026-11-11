export type JobDetailDialog = "closed" | "tailor" | "answers";
export function jobDetailDialogTransition(state: JobDetailDialog, event: JobDetailDialog): JobDetailDialog {
    return event === "closed" || state === "closed" ? event : state;
}
