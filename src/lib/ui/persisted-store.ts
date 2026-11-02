"use client";

// Minimal external store with optional Web Storage persistence, for UI state
// that must survive a `router.refresh()` (revalidatePath re-renders the page)
// without living in React state derived from props. Server snapshot = initial.

import { useSyncExternalStore } from "react";

export interface Store<T> {
    get: () => T;
    set: (next: T | ((prev: T) => T)) => void;
    subscribe: (cb: () => void) => () => void;
}

export function createPersistedStore<T>(opts: {
    key: string;
    storage: "local" | "session";
    initial: T;
    serialize?: (v: T) => string;
    deserialize?: (s: string) => T;
}): Store<T> & { useValue: () => T } {
    const serialize = opts.serialize ?? ((v: T) => JSON.stringify(v));
    const deserialize = opts.deserialize ?? ((s: string) => JSON.parse(s) as T);
    let value: T = opts.initial;
    let hydrated = false;
    const listeners = new Set<() => void>();

    const storage = () => {
        try { return opts.storage === "local" ? window.localStorage : window.sessionStorage; } catch { return null; }
    };
    const hydrate = () => {
        if (hydrated) return;
        hydrated = true;
        try {
            const raw = storage()?.getItem(opts.key);
            if (raw !== null && raw !== undefined) value = deserialize(raw);
        } catch { /* ignore */ }
    };
    const get = () => { hydrate(); return value; };
    const getServerSnapshot = () => opts.initial;
    const set = (next: T | ((prev: T) => T)) => {
        hydrate();
        value = typeof next === "function" ? (next as (p: T) => T)(value) : next;
        try { storage()?.setItem(opts.key, serialize(value)); } catch { /* ignore */ }
        listeners.forEach(l => l());
    };
    const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
    const useValue = () => useSyncExternalStore(subscribe, get, getServerSnapshot);
    return { get, set, subscribe, useValue };
}
