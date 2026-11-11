export type FormsOperation<K, R = undefined> =
    | { status: "idle" }
    | { status: "running"; id: number; operation: K }
    | { status: "succeeded"; result: R }
    | { status: "failed"; error: string };
export type FormsEvent<K, R> =
    | { type: "start"; id: number; operation: K }
    | { type: "succeed"; id: number; result: R }
    | { type: "fail"; id: number; error: string }
    | { type: "progress"; id: number; operation: K }
    | { type: "reset" };
/** Completion events only belong to the currently active request. */
export function formsTransition<K, R>(state: FormsOperation<K, R>, event: FormsEvent<K, R>): FormsOperation<K, R> {
    if (event.type === "reset") return { status: "idle" };
    if (event.type === "start") return { status: "running", id: event.id, operation: event.operation };
    if (state.status !== "running" || state.id !== event.id) return state;
    if (event.type === "progress") return { ...state, operation: event.operation };
    return event.type === "fail" ? { status: "failed", error: event.error } : { status: "succeeded", result: event.result };
}
