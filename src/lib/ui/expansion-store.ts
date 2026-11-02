"use client";

import { createPersistedStore } from "./persisted-store";

/** Ids of expanded library rows; survives revalidation refreshes within the tab. */
const store = createPersistedStore<ReadonlySet<string>>({
    key: "quikresume.expandedRows",
    storage: "session",
    initial: new Set<string>(),
    serialize: s => JSON.stringify([...s]),
    deserialize: s => new Set(JSON.parse(s) as string[]),
});

export const useExpandedIds = () => store.useValue();

export const expansion = {
    toggle(id: string) {
        store.set(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    },
    expand(ids: string[]) {
        store.set(prev => { const n = new Set(prev); ids.forEach(i => n.add(i)); return n; });
    },
    collapse(ids: string[]) {
        store.set(prev => { const n = new Set(prev); ids.forEach(i => n.delete(i)); return n; });
    },
};
