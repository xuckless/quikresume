/** Pure state machine behind `useOperation`: one async action in flight at a time. */
export type Operation<K extends string = "run", R = void> =
    | { status: "idle" }
    | { status: "running"; kind: K; token: number }
    | { status: "succeeded"; kind: K; result: R }
    | { status: "failed"; kind: K; error: string };

export type OperationEvent<K extends string, R> =
    | { type: "start"; kind: K; token: number }
    | { type: "step"; token: number; kind: K }
    | { type: "succeed"; token: number; result: R }
    | { type: "fail"; token: number; error: string }
    | { type: "reject"; kind: K; error: string }
    | { type: "reset" };

/** Completion events belong to the running token only; anything else returns the same state object. */
export function operationTransition<K extends string, R>(
    state: Operation<K, R>,
    event: OperationEvent<K, R>,
): Operation<K, R> {
    if (event.type === "reset") return { status: "idle" };
    if (event.type === "start") {
        return state.status === "running" ? state : { status: "running", kind: event.kind, token: event.token };
    }
    if (event.type === "reject") {
        return state.status === "running" ? state : { status: "failed", kind: event.kind, error: event.error };
    }
    if (state.status !== "running" || state.token !== event.token) return state;
    if (event.type === "step") return { status: "running", kind: event.kind, token: state.token };
    if (event.type === "succeed") return { status: "succeeded", kind: state.kind, result: event.result };
    return { status: "failed", kind: state.kind, error: event.error };
}
