import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The app-origin relay (entrypoints/site.content.ts): page <-> background.
const ID = "12345678-1234-1234-1234-123456789abc";
let onPageMessage: (e: MessageEvent) => Promise<void>;
let posted: { type: string }[];
let ports: any[];
let runtime: any;

beforeEach(async () => {
    vi.resetModules();
    posted = [];
    ports = [];
    runtime = {
        id: "ext",
        connect: () => {
            const port: any = { postMessage: vi.fn(), disconnect: vi.fn(), onMessage: { addListener: (fn: any) => { port.receive = fn; } }, onDisconnect: { addListener: (fn: any) => { port.drop = fn; } } };
            ports.push(port);
            return port;
        },
        sendMessage: vi.fn().mockResolvedValue({ paired: true }),
        getManifest: () => ({ version: "1.2.3" }),
    };
    vi.stubGlobal("chrome", { runtime });
    vi.stubGlobal("__APP_URL__", "https://app.example");
    vi.stubGlobal("defineContentScript", (config: { main: () => void }) => config.main());
    vi.spyOn(window, "postMessage").mockImplementation((m: any) => { posted.push(m); });
    const add = window.addEventListener.bind(window);
    vi.spyOn(window, "addEventListener").mockImplementation(((name: string, fn: any) => { if (name === "message") onPageMessage = fn; else add(name, fn); }) as typeof window.addEventListener);
    await import("../entrypoints/site.content");
    await new Promise(r => setTimeout(r, 0));
    posted = [];
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const fromPage = (data: object) => onPageMessage({ source: window, origin: window.location.origin, data: { source: "quikresume-app", ...data } } as unknown as MessageEvent);

describe("site content script", () => {
    it("answers ping with hello, including LinkedIn support", async () => {
        await fromPage({ type: "ping" });
        expect(posted).toEqual([{ source: "quikresume-ext", type: "hello", version: "1.2.3", paired: true, linkedIn: true }]);
    });

    it("ignores messages from other windows and malformed ones", async () => {
        await onPageMessage({ source: {}, origin: window.location.origin, data: { source: "quikresume-app", type: "ping" } } as unknown as MessageEvent);
        await fromPage({ type: "linkedin-start", id: "not-a-uuid", uid: "u", url: "https://www.linkedin.com/in/alice" });
        expect(posted).toEqual([]);
        expect(ports).toEqual([]);
    });

    it("relays a session over one port and closes it on cancel", async () => {
        await fromPage({ type: "linkedin-start", id: ID, uid: "alice", url: "https://www.linkedin.com/in/alice" });
        expect(ports).toHaveLength(1);
        expect(ports[0].postMessage).toHaveBeenCalledWith({ type: "linkedin-start", id: ID, uid: "alice", url: "https://www.linkedin.com/in/alice" });
        ports[0].receive({ type: "linkedin-started", id: ID });
        expect(posted).toEqual([{ source: "quikresume-ext", type: "linkedin-started", id: ID }]);
        await fromPage({ type: "linkedin-cancel", id: ID });
        expect(ports[0].disconnect).toHaveBeenCalled();
    });

    it("does not open a port just to cancel", async () => {
        await fromPage({ type: "linkedin-cancel", id: ID });
        expect(ports).toEqual([]);
    });

    it("reports a lost background and reconnects for the next session", async () => {
        await fromPage({ type: "linkedin-start", id: ID, uid: "alice", url: "https://www.linkedin.com/in/alice" });
        ports[0].drop();
        expect(posted).toEqual([{ source: "quikresume-ext", type: "disconnected" }]);
        await fromPage({ type: "linkedin-start", id: ID, uid: "alice", url: "https://www.linkedin.com/in/alice" });
        expect(ports).toHaveLength(2);
    });

    it("tells the page to reload once the extension was reloaded", async () => {
        delete runtime.id;
        await fromPage({ type: "ping" });
        expect(posted).toEqual([{ source: "quikresume-ext", type: "disconnected" }]);
    });
});
