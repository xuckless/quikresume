"use client";
import { useEffect, useRef, useState } from "react";
import { formsTransition, type FormsEvent, type FormsOperation } from "./forms-operation";

export function useFormsOperation<K, R = undefined>() {
    const [state, setState] = useState<FormsOperation<K, R>>({ status: "idle" });
    const current = useRef(state);
    const sequence = useRef(0);
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const send = (event: FormsEvent<K, R>) => {
        current.current = formsTransition(current.current, event);
        if (mounted.current) setState(current.current);
    };
    return {
        state,
        begin(operation: K) {
            if (current.current.status === "running") return null;
            const id = ++sequence.current;
            send({ type: "start", id, operation });
            return id;
        },
        active(id: number) { return mounted.current && current.current.status === "running" && current.current.id === id; },
        progress(id: number, operation: K) { send({ type: "progress", id, operation }); },
        succeed(id: number, result: R) { send({ type: "succeed", id, result }); },
        fail(id: number, error: string) { send({ type: "fail", id, error }); },
        reset() { sequence.current++; send({ type: "reset" }); },
    };
}
