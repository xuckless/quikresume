import type { JobRecord } from "../match/types";
export type DeleteState = { status: "closed" } | { status: "confirm"; job: JobRecord } | { status: "deleting"; job: JobRecord } | { status: "failed"; job: JobRecord; message: string };
export type DeleteEvent = { type: "open"; job: JobRecord } | { type: "start" } | { type: "cancel" } | { type: "complete" } | { type: "fail"; message: string };
export function deleteTransition(state: DeleteState, event: DeleteEvent): DeleteState {
    if (event.type === "open") return state.status === "deleting" ? state : { status: "confirm", job: event.job };
    if (event.type === "cancel") return state.status === "deleting" ? state : { status: "closed" };
    if (event.type === "complete") return state.status === "deleting" ? { status: "closed" } : state;
    if (event.type === "start") return state.status === "confirm" || state.status === "failed" ? { status: "deleting", job: state.job } : state;
    return state.status === "deleting" ? { status: "failed", job: state.job, message: event.message } : state;
}

