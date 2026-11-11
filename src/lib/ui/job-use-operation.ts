"use client";
import { useEffect, useRef, useState } from "react";
import { jobOperationTransition, type JobOperationEvent, type JobOperationState } from "./job-operation-state";

/** Synchronous admission prevents duplicate clicks; tokens reject completions after disposal. */
export function useJobOperation<K extends string>() {
    const current = useRef<JobOperationState<K>>({ status: "idle" });
    const generation = useRef(0);
    const [state, setState] = useState<JobOperationState<K>>({ status: "idle" });
    useEffect(() => () => { generation.current++; current.current = { status: "idle" }; }, []);
    const send = (event: JobOperationEvent<K>) => {
        current.current = jobOperationTransition(current.current, event);
        setState(current.current);
    };
    const start = (operation: K) => {
        if (current.current.status === "running") return null;
        const token = ++generation.current;
        send({ type: "start", operation });
        return {
            active: () => generation.current === token,
            advance: (operation: K) => { if (generation.current === token) send({ type: "advance", operation }); },
            complete: () => { if (generation.current === token) send({ type: "complete" }); },
            fail: (message: string) => { if (generation.current === token) send({ type: "fail", message }); },
        };
    };
    return { state, start, dismiss: () => send({ type: "dismiss" }) };
}
