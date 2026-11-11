"use client";
import { useEffect, useRef, useState } from "react";
import { operationTransition, type Operation, type OperationEvent } from "./operation";

/*
 * Use this for a single-flight async action (save, import, delete, re-check): one thing in flight,
 * then success or an error message. If the flow has several user-driven steps, branches or data that
 * evolves between steps, write a dedicated reducer instead.
 *
 * The authoritative state lives in a ref so admission is synchronous (two `run` calls in one tick
 * admit only the first); it is mirrored to useState for rendering.
 */

export type Settled<R> = { ok: true; result: R } | { ok: false; error: string };

export function useOperation<K extends string = "run", R = void>() {
    const [state, setState] = useState<Operation<K, R>>({ status: "idle" });
    const current = useRef<Operation<K, R>>({ status: "idle" });
    const sequence = useRef(0);
    const mounted = useRef(true);

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            current.current = { status: "idle" };
        };
    }, []);

    const send = (event: OperationEvent<K, R>) => {
        const next = operationTransition(current.current, event);
        if (next === current.current) return;
        current.current = next;
        if (mounted.current) setState(next);
    };

    const isCurrent = (token: number) => {
        const now = current.current;
        return now.status === "running" && now.token === token;
    };

    async function run(
        kind: K,
        task: (op: { step(kind: K): void }) => Promise<R>,
        fallback = "Something went wrong. Please try again.",
    ): Promise<Settled<R> | null> {
        if (current.current.status === "running") return null;
        const token = ++sequence.current;
        send({ type: "start", kind, token });
        try {
            const result = await task({ step: (next) => send({ type: "step", token, kind: next }) });
            if (!isCurrent(token)) return null;
            send({ type: "succeed", token, result });
            return { ok: true, result };
        } catch (e) {
            if (!isCurrent(token)) return null;
            const error = e instanceof Error && e.message ? e.message : fallback;
            send({ type: "fail", token, error });
            return { ok: false, error };
        }
    }

    return {
        state,
        running: state.status === "running" ? state.kind : null,
        error: state.status === "failed" ? state.error : null,
        run,
        reject(kind: K, error: string) { send({ type: "reject", kind, error }); },
        reset() { sequence.current++; send({ type: "reset" }); },
    };
}
