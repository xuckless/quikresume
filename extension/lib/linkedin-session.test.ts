import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLinkedInImport, IDLE, MESSAGES, reduceLinkedIn, type LinkedInState } from "./linkedin-session";

const ID = "12345678-1234-1234-1234-123456789abc";
const URL_ = "https://www.linkedin.com/in/alice";
const DATA = { personalInfo: { name: "Alice" }, workExperience: [{ title: "Engineer", company: "Example", startDate: "2020", endDate: "Present", bullets: [] }] };

describe("reduceLinkedIn", () => {
    const waiting: LinkedInState = { phase: "waiting", id: ID, url: URL_, tabId: 7, error: null };

    it("walks start -> opened -> capture -> captured -> received", () => {
        let s = reduceLinkedIn(IDLE, { type: "start", id: ID, url: URL_ });
        s = reduceLinkedIn(s, { type: "opened", id: ID, tabId: 7 });
        expect(s).toEqual(waiting);
        s = reduceLinkedIn(reduceLinkedIn(s, { type: "capture", id: ID }), { type: "captured", id: ID });
        expect(s.phase).toBe("sending");
        expect(reduceLinkedIn(s, { type: "received", id: ID, ok: true }).phase).toBe("done");
    });

    it("ignores events for another session and repeats", () => {
        expect(reduceLinkedIn(waiting, { type: "capture", id: "other" })).toBe(waiting);
        const capturing = reduceLinkedIn(waiting, { type: "capture", id: ID });
        expect(reduceLinkedIn(capturing, { type: "capture", id: ID })).toBe(capturing);
        expect(reduceLinkedIn(waiting, { type: "start", id: ID, url: URL_ })).toBe(waiting);
    });

    it("returns to waiting with the error on a failed capture or a refused one", () => {
        const capturing = reduceLinkedIn(waiting, { type: "capture", id: ID });
        expect(reduceLinkedIn(capturing, { type: "capture-failed", id: ID, error: "Nope" })).toEqual({ ...waiting, error: "Nope" });
        const sending = reduceLinkedIn(capturing, { type: "captured", id: ID });
        expect(reduceLinkedIn(sending, { type: "received", id: ID, ok: false, error: "Empty" })).toEqual({ ...waiting, error: "Empty" });
    });

    it("goes through analysing when the AI reads the profile", () => {
        const capturing = reduceLinkedIn(waiting, { type: "capture", id: ID });
        const analysing = reduceLinkedIn(capturing, { type: "analyse", id: ID });
        expect(analysing).toEqual({ phase: "analysing", id: ID, url: URL_, tabId: 7 });
        expect(reduceLinkedIn(waiting, { type: "analyse", id: ID })).toBe(waiting);
        expect(reduceLinkedIn(analysing, { type: "captured", id: ID }).phase).toBe("sending");
        expect(reduceLinkedIn(analysing, { type: "capture-failed", id: ID, error: "AI down" })).toEqual({ ...waiting, error: "AI down" });
        expect(reduceLinkedIn(analysing, { type: "end", id: ID, error: "Closed" }).phase).toBe("ended");
    });

    it("ends live sessions but keeps a finished one", () => {
        expect(reduceLinkedIn(waiting, { type: "end", id: ID, error: "Closed" })).toMatchObject({ phase: "ended", error: "Closed", tabId: 7 });
        const done: LinkedInState = { phase: "done", id: ID, url: URL_, tabId: 7 };
        expect(reduceLinkedIn(done, { type: "end", id: ID, error: "Closed" })).toBe(done);
        expect(reduceLinkedIn(done, { type: "dismiss" })).toBe(IDLE);
        expect(reduceLinkedIn(waiting, { type: "dismiss" })).toBe(waiting);
    });
});

// ---------- The background driver against a fake chrome ----------

type Listener = (...args: any[]) => unknown;
const event = () => {
    const listeners: Listener[] = [];
    return { addListener: (fn: Listener) => listeners.push(fn), emit: async (...args: unknown[]) => { for (const fn of listeners) await fn(...args); } };
};

let chromeMock: any;
let tabUrl: string;
let captureReply: unknown;
let account: string;
let analyse: ReturnType<typeof vi.fn>;

function makePort(url = "https://app.example/dashboard?view=import") {
    return { name: "linkedin-import", sender: { tab: { id: 1 }, url }, onMessage: event(), onDisconnect: event(), postMessage: vi.fn(), disconnect: vi.fn() };
}

/** A fresh worker: empty session storage. */
async function setup() {
    const store: Record<string, unknown> = {};
    chromeMock.storage.session = { get: async (k: string) => ({ [k]: store[k] }), set: async (v: object) => { Object.assign(store, v); } };
    const li = createLinkedInImport({ appOrigin: "https://app.example", accountId: async () => account, analyse });
    const port = makePort();
    li.onConnect(port as unknown as chrome.runtime.Port);
    const say = async (m: object) => { await port.onMessage.emit(m); await flush(); };
    const state = () => li.handle({ type: "linkedin-state" }) as Promise<LinkedInState>;
    const sent = (type: string) => port.postMessage.mock.calls.map(c => c[0]).filter((m: { type: string }) => m.type === type);
    return { li, port, say, state, sent };
}
const flush = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
    tabUrl = URL_;
    account = "alice";
    captureReply = { ok: true, data: DATA, warnings: ["Skills may be incomplete."], unread: [], topCard: true, text: null };
    analyse = vi.fn(async () => ({ workExperience: [] }));
    const store: Record<string, unknown> = {};
    chromeMock = {
        runtime: { sendMessage: vi.fn().mockResolvedValue(undefined) },
        storage: { session: { get: async (k: string) => ({ [k]: store[k] }), set: async (v: object) => { Object.assign(store, v); } } },
        tabs: {
            create: vi.fn().mockResolvedValue({ id: 42 }),
            get: vi.fn(async () => ({ url: tabUrl })),
            sendMessage: vi.fn(async (_tab: number, m: { type: string }) => (m.type === "capture-profile" ? captureReply : { loginWall: false })),
        },
        sidePanel: { open: vi.fn().mockResolvedValue(undefined) },
        scripting: { executeScript: vi.fn().mockResolvedValue([]) },
    };
    vi.stubGlobal("chrome", chromeMock);
});

const start = { type: "linkedin-start", id: ID, uid: "alice", url: "https://linkedin.com/in/Alice/" };

describe("createLinkedInImport", () => {
    it("happy path: opens the canonical profile, captures, sends the structured profile, finishes on receipt", async () => {
        const { li, say, state, sent } = await setup();
        await say(start);
        expect(chromeMock.tabs.create).toHaveBeenCalledWith({ url: URL_ });
        expect(sent("linkedin-started")).toEqual([{ type: "linkedin-started", id: ID }]);
        await li.handle({ type: "linkedin-capture", id: ID });
        await flush();
        expect(sent("linkedin-captured")).toEqual([{ type: "linkedin-captured", id: ID, url: URL_, data: DATA, warnings: ["Skills may be incomplete."] }]);
        expect((await state()).phase).toBe("sending");
        await say({ type: "linkedin-received", id: ID, ok: true });
        expect((await state()).phase).toBe("done");
        // The page's later cancel (it leaves the Import view) does not undo the checkmark.
        await say({ type: "linkedin-cancel", id: ID });
        expect((await state()).phase).toBe("done");
    });

    it("refuses ports from other origins", async () => {
        const li = createLinkedInImport({ appOrigin: "https://app.example", accountId: async () => account, analyse });
        const port = makePort("https://evil.example/dashboard");
        li.onConnect(port as unknown as chrome.runtime.Port);
        expect(port.disconnect).toHaveBeenCalled();
    });

    it("refuses a page whose user is not the paired account, before opening LinkedIn", async () => {
        account = "bob";
        const { say, state, sent } = await setup();
        await say(start);
        expect(chromeMock.tabs.create).not.toHaveBeenCalled();
        expect(sent("linkedin-ended")).toEqual([{ type: "linkedin-ended", id: ID, error: MESSAGES.account, reason: "account" }]);
        expect((await state()).phase).toBe("ended");
    });

    it("blocks a capture when the tab is not the expected profile, without reading the page", async () => {
        const { li, say, state, sent } = await setup();
        await say(start);
        tabUrl = "https://www.linkedin.com/in/bob";
        await li.handle({ type: "linkedin-capture", id: ID });
        await flush();
        expect(chromeMock.tabs.sendMessage).not.toHaveBeenCalledWith(42, expect.objectContaining({ type: "capture-profile" }));
        expect(sent("linkedin-capture-failed")).toEqual([{ type: "linkedin-capture-failed", id: ID, error: MESSAGES.mismatch }]);
        expect(await state()).toMatchObject({ phase: "waiting", error: MESSAGES.mismatch });
    });

    it("rejects a capture when LinkedIn navigated away while reading", async () => {
        const { li, say, sent } = await setup();
        await say(start);
        chromeMock.tabs.sendMessage.mockImplementation(async () => { tabUrl = "https://www.linkedin.com/feed/"; return captureReply; });
        await li.handle({ type: "linkedin-capture", id: ID });
        await flush();
        expect(sent("linkedin-captured")).toEqual([]);
        expect(sent("linkedin-capture-failed")[0]).toMatchObject({ error: MESSAGES.moved });
    });

    it("injects the profile script into a tab that has none, then captures", async () => {
        const { li, say, sent } = await setup();
        await say(start);
        let calls = 0;
        chromeMock.tabs.sendMessage.mockImplementation(async () => { if (++calls === 1) throw new Error("Receiving end does not exist"); return captureReply; });
        await li.handle({ type: "linkedin-capture", id: ID });
        await flush();
        expect(chromeMock.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 42 }, files: ["/content-scripts/linkedin-profile.js"] });
        expect(sent("linkedin-captured")).toHaveLength(1);
    });

    it("re-checks the paired account before each capture", async () => {
        const { li, say, sent } = await setup();
        await say(start);
        account = "bob";
        await li.handle({ type: "linkedin-capture", id: ID });
        await flush();
        expect(sent("linkedin-ended")[0]).toMatchObject({ reason: "account" });
    });

    it("ends the session when the page cancels, the tab closes, or the page goes away", async () => {
        const a = await setup();
        await a.say(start);
        await a.say({ type: "linkedin-cancel", id: "00000000-0000-0000-0000-000000000000" });
        expect((await a.state()).phase).toBe("waiting");
        await a.say({ type: "linkedin-cancel", id: ID });
        expect(await a.state()).toMatchObject({ phase: "ended", error: MESSAGES.cancelled });

        const b = await setup();
        await b.say(start);
        b.li.onTabRemoved(42);
        await flush();
        expect(b.sent("linkedin-ended")[0]).toMatchObject({ error: MESSAGES.tabClosed });

        const c = await setup();
        await c.say(start);
        await c.port.onDisconnect.emit();
        await flush();
        expect(await c.state()).toMatchObject({ phase: "ended", error: MESSAGES.pageGone });
    });

    it("ignores a capture finishing after the session was cancelled", async () => {
        const { li, say, state, sent } = await setup();
        await say(start);
        let resolve!: (v: unknown) => void;
        chromeMock.tabs.sendMessage.mockImplementation(() => new Promise(r => { resolve = r; }));
        void li.handle({ type: "linkedin-capture", id: ID });
        await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
        await say({ type: "linkedin-cancel", id: ID });
        resolve(captureReply);
        await flush();
        expect(sent("linkedin-captured")).toEqual([]);
        expect((await state()).phase).toBe("ended");
    });

    it("reads an unsure capture with AI: fills the unread section, keeps the rest, and says so", async () => {
        captureReply = {
            ok: true, data: { personalInfo: { name: "Alice" }, workExperience: [], education: [{ degree: "BSc", institution: "Uni", startDate: "2010", endDate: "2014" }] },
            warnings: ["Could not read Experience."], unread: ["workExperience"], topCard: true, text: "Alice\nExperience\nEngineer\nExample",
        };
        const job = { title: "Engineer", company: "Example", startDate: "2020", endDate: "Present", bullets: [] };
        analyse.mockResolvedValue({ personalInfo: { firstName: "Al", lastName: "Ice", headline: "Builder" }, workExperience: [job], education: [] });
        const { li, say, state, sent } = await setup();
        await say(start);
        await li.handle({ type: "linkedin-capture", id: ID });
        await flush();
        expect(analyse).toHaveBeenCalledWith(URL_, "Alice\nExperience\nEngineer\nExample");
        expect(sent("linkedin-analysing")).toEqual([{ type: "linkedin-analysing", id: ID }]);
        const [captured] = sent("linkedin-captured");
        expect(captured.data).toEqual({
            personalInfo: { name: "Alice", headline: "Builder" },
            workExperience: [job],
            education: [{ degree: "BSc", institution: "Uni", startDate: "2010", endDate: "2014" }],
        });
        expect(captured.warnings).toEqual(["Read with AI: Experience. Check the details."]);
        expect((await state()).phase).toBe("sending");
    });

    it("does not call the AI when the parser is confident", async () => {
        const { li, say, sent } = await setup();
        await say(start);
        await li.handle({ type: "linkedin-capture", id: ID });
        await flush();
        expect(analyse).not.toHaveBeenCalled();
        expect(sent("linkedin-analysing")).toEqual([]);
    });

    it("delivers a partial capture with a warning when the AI fails, and fails the capture when nothing was read", async () => {
        captureReply = { ok: true, data: DATA, warnings: ["Could not read Skills."], unread: ["skills"], topCard: true, text: "Alice" };
        analyse.mockRejectedValue(new Error("Daily AI limit reached."));
        const a = await setup();
        await a.say(start);
        await a.li.handle({ type: "linkedin-capture", id: ID });
        await flush();
        expect(a.sent("linkedin-captured")[0].warnings).toEqual(["Could not read Skills.", expect.stringContaining("reading them with AI failed (Daily AI limit reached)")]);

        captureReply = { ok: true, data: { personalInfo: {} }, warnings: [], unread: [], topCard: false, text: "Something LinkedIn changed" };
        const b = await setup();
        await b.say(start);
        await b.li.handle({ type: "linkedin-capture", id: ID });
        await flush();
        expect(b.sent("linkedin-captured")).toEqual([]);
        expect(b.sent("linkedin-capture-failed")[0].error).toBe(MESSAGES.unreadable("Daily AI limit reached."));
        expect(await b.state()).toMatchObject({ phase: "waiting", error: MESSAGES.unreadable("Daily AI limit reached.") });
    });

    it("drops an AI reading that finishes after the session was cancelled", async () => {
        captureReply = { ok: true, data: { personalInfo: {} }, warnings: [], unread: [], topCard: false, text: "Profile text" };
        let resolve!: (v: unknown) => void;
        analyse.mockImplementation(() => new Promise(r => { resolve = r; }));
        const { li, say, state, sent } = await setup();
        await say(start);
        void li.handle({ type: "linkedin-capture", id: ID });
        await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
        expect((await state()).phase).toBe("analysing");
        await say({ type: "linkedin-cancel", id: ID });
        resolve({ personalInfo: { name: "Alice" } });
        await flush();
        expect(sent("linkedin-captured")).toEqual([]);
        expect((await state()).phase).toBe("ended");
    });

    it("reports an import interrupted by a worker restart", async () => {
        await chrome.storage.session.set({ linkedin: { phase: "waiting", id: ID, url: URL_, tabId: 42, error: null } });
        const li = createLinkedInImport({ appOrigin: "https://app.example", accountId: async () => account, analyse });
        expect(await li.handle({ type: "linkedin-state" })).toMatchObject({ phase: "ended", error: MESSAGES.interrupted });
    });
});
