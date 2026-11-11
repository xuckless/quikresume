export type JobOperationState<K extends string> =
    | { status: "idle" }
    | { status: "running"; operation: K }
    | { status: "failed"; message: string };
export type JobOperationEvent<K extends string> =
    | { type: "start"; operation: K }
    | { type: "advance"; operation: K }
    | { type: "complete" }
    | { type: "fail"; message: string }
    | { type: "invalid"; message: string }
    | { type: "dismiss" };
export function jobOperationTransition<K extends string>(state: JobOperationState<K>, event: JobOperationEvent<K>): JobOperationState<K> {
    switch (event.type) {
        case "start": return state.status === "running" ? state : { status: "running", operation: event.operation };
        case "advance": return state.status === "running" ? { status: "running", operation: event.operation } : state;
        case "complete": return state.status === "running" ? { status: "idle" } : state;
        case "fail": return state.status === "running" ? { status: "failed", message: event.message } : state;
        case "invalid": return state.status !== "running" ? { status: "failed", message: event.message } : state;
        case "dismiss": return state.status === "failed" ? { status: "idle" } : state;
    }
}
