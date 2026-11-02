import { describe, expect, it, vi } from "vitest";
import { createPersistedStore } from "@/lib/ui/persisted-store";

const { useSyncExternalStore } = vi.hoisted(() => ({ useSyncExternalStore: vi.fn(() => "initial") }));
vi.mock("react", () => ({ useSyncExternalStore }));

describe("createPersistedStore", () => {
    it("exposes its subscription through a custom-hook-named method", () => {
        const store = createPersistedStore({ key: "test", storage: "local", initial: "initial" });

        expect(store.useValue()).toBe("initial");
        expect(useSyncExternalStore).toHaveBeenCalledWith(store.subscribe, expect.any(Function), expect.any(Function));
    });
});
