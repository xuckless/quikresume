// Background service worker: the only place that holds the token and talks to the quikResume API.
// Keeps per-tab state (detected posting, saved job summary) in chrome.storage.session so it survives
// the worker being suspended, drives the toolbar badge, and answers the side panel / content scripts.
// Import from LinkedIn lives in lib/linkedin-session.ts; this file only wires its listeners.

import { api, apiBytes, ApiError, appUrl, clearToken, getToken, setToken } from "../lib/api";
import type { AutofillData } from "../lib/fields";
import { createLinkedInImport, type LinkedInImport } from "../lib/linkedin-session";
import { AUTOFILL_TIMEOUT_MS, emptyState, type Handler, isLegacyKey, settleInterrupted, stateKey } from "../lib/tab-state";
import type { AccountStatus, BgRequest, JobSummary, Posting, TabState, TailorResult, VariantInfo } from "../lib/types";

/** Handlers of THIS worker that are mid-request. A stored "in flight" phase without one was left by a worker that died. */
const inflight = new Set<string>();

/** Runs `work` unless the same handler is already running for the tab (checked synchronously, so two messages cannot both pass). */
async function exclusive(handler: Handler, tabId: number, work: () => Promise<void>): Promise<void> {
    const id = `${handler}:${tabId}`;
    if (inflight.has(id)) return;
    inflight.add(id);
    try {
        await work();
    } finally {
        inflight.delete(id);
    }
}

async function getState(tabId: number): Promise<TabState> {
    const stored = (await chrome.storage.session.get(stateKey(tabId)))[stateKey(tabId)] as TabState | undefined;
    return stored ? settleInterrupted(stored, Date.now(), h => inflight.has(`${h}:${tabId}`)) : emptyState();
}

async function setState(tabId: number, patch: Partial<TabState>): Promise<TabState> {
    const next = { ...(await getState(tabId)), ...patch };
    await chrome.storage.session.set({ [stateKey(tabId)]: next });
    await paintBadge(tabId, next);
    chrome.runtime.sendMessage({ type: "state-changed", tabId }).catch(() => undefined);
    chrome.tabs.sendMessage(tabId, { type: "tab-state", state: next }).catch(() => undefined);
    return next;
}

async function paintBadge(tabId: number, s: TabState) {
    const text = s.save.phase === "saving" ? "…" : s.summary ? String(s.summary.score) : s.posting ? "•" : "";
    await chrome.action.setBadgeText({ tabId, text }).catch(() => undefined);
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#003200" }).catch(() => undefined);
    await chrome.action.setBadgeTextColor?.({ tabId, color: "#ffffff" }).catch(() => undefined);
}

/** Reads or changes the tab's saved job through `/api/ext/jobs/<id>`; a failure becomes the tab's notice. */
async function updateSummary(tabId: number, request: (jobId: string) => [path: string, init?: Parameters<typeof api>[1]], also: Partial<TabState> = {}) {
    const s = await getState(tabId);
    if (!s.summary) return;
    try {
        const res = await api<{ summary: JobSummary }>(...request(s.summary.job.id));
        await setState(tabId, { summary: res.summary, notice: null, ...also });
    } catch (err) {
        await setState(tabId, { notice: errorText(err) });
    }
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");

/** A saved job for this posting, if any (by canonical URL on the server). */
async function lookup(tabId: number, posting: Posting) {
    if (!(await getToken())) return;
    try {
        const res = await api<{ job: JobSummary | null }>(`/api/ext/jobs?url=${encodeURIComponent(posting.url)}`);
        const cur = await getState(tabId);
        if (cur.posting?.url === posting.url) await setState(tabId, { summary: res.job });
    } catch (err) {
        if (!(err instanceof ApiError && err.status === 401)) console.warn("[quikresume] lookup failed", err);
    }
}

function deviceName(): string {
    const ua = navigator.userAgent;
    const os = /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : "";
    const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Brave/.test(ua) ? "Brave" : "Chrome";
    return os ? `${browser} on ${os}` : browser;
}

let cachedUser: AccountStatus["user"] = null;

/** Profile + preferences (+ PDF) for one Auto Fill run, shared by every frame of the tab. */
const runs = new Map<number, { at: number; data?: Promise<AutofillData>; pdf?: Promise<{ base64: string; fileName: string } | null> }>();

function toBase64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
}

async function jobIdOf(tabId: number): Promise<string | null> {
    return (await getState(tabId)).summary?.job.id ?? null;
}

async function status(): Promise<AccountStatus> {
    const token = await getToken();
    if (!token) return { paired: false, user: null };
    if (!cachedUser) {
        try {
            cachedUser = (await api<{ user: AccountStatus["user"] }>("/api/ext/me")).user;
        } catch (err) {
            if (err instanceof ApiError && err.status === 401) return { paired: false, user: null };
        }
    }
    return { paired: true, user: cachedUser };
}

async function handle(msg: BgRequest, sender: chrome.runtime.MessageSender): Promise<unknown> {
    switch (msg.type) {
        case "linkedin-state":
        case "linkedin-capture":
        case "linkedin-dismiss":
            if (sender.tab) return null; // side panel only
            return linkedIn.handle(msg);
        case "detected": {
            const tabId = sender.tab?.id;
            if (tabId === undefined) return null;
            const cur = await getState(tabId);
            const same = cur.posting?.url === msg.posting?.url;
            // Leaving the posting for its application form keeps the job (Auto Fill uses it); a new posting replaces it.
            const keep = same || msg.posting === null;
            const next = await setState(tabId, { posting: msg.posting, summary: keep ? cur.summary : null, tailor: keep ? cur.tailor : null, save: same ? cur.save : { phase: "idle" }, notice: same ? cur.notice : null });
            if (msg.posting && !same) void lookup(tabId, msg.posting);
            return next;
        }
        case "open-panel": {
            const tabId = sender.tab?.id;
            if (tabId !== undefined) await chrome.sidePanel.open({ tabId });
            return null;
        }
        case "pair": {
            try {
                const res = await api<{ token: string }>("/api/ext/pair", { method: "POST", body: { code: msg.code, deviceName: deviceName(), replaces: (await getToken()) ?? undefined }, auth: false });
                await setToken(res.token);
                cachedUser = null;
                chrome.runtime.sendMessage({ type: "account-changed" }).catch(() => undefined);
                return { ok: true };
            } catch (err) {
                return { ok: false, error: errorText(err) };
            }
        }
        case "status":
            return status();
        case "signout": {
            await api("/api/ext/signout", { method: "POST" }).catch(() => undefined);
            await clearToken();
            cachedUser = null;
            chrome.runtime.sendMessage({ type: "account-changed" }).catch(() => undefined);
            return { ok: true };
        }
        case "tab-state":
            return getState(msg.tabId);
        case "scan": {
            await setState(msg.tabId, { notice: null });
            try {
                await chrome.scripting.executeScript({ target: { tabId: msg.tabId }, files: ["/content-scripts/scan.js"] });
            } catch {
                await setState(msg.tabId, { notice: "This page can't be read (browser pages and the Web Store are off limits)." });
            }
            return null;
        }
        case "save":
            await exclusive("save", msg.tabId, async () => {
                const p = (await getState(msg.tabId)).posting;
                if (!p) return;
                await setState(msg.tabId, { save: { phase: "saving" }, notice: null });
                try {
                    const res = await api<{ summary: JobSummary | null }>("/api/ext/jobs", {
                        method: "POST",
                        body: { url: p.url, title: p.title, company: p.company, location: p.location, employmentType: p.employmentType, description: p.description, extractionMethod: p.method },
                    });
                    // The tab moved on to another posting meanwhile: the new one starts clean.
                    if ((await getState(msg.tabId)).posting?.url !== p.url) return;
                    await setState(msg.tabId, { save: { phase: "idle" }, summary: res.summary });
                } catch (err) {
                    await setState(msg.tabId, { save: { phase: "failed", error: errorText(err) } });
                }
            });
            return null;
        case "refresh":
            await updateSummary(msg.tabId, id => [`/api/ext/jobs/${id}`]);
            return null;
        case "set-status":
            await updateSummary(msg.tabId, id => [`/api/ext/jobs/${id}`, { method: "PATCH", body: { status: msg.status } }]);
            return null;
        case "variants":
            try {
                return { ok: true, variants: (await api<{ variants: VariantInfo[] }>("/api/ext/variants")).variants };
            } catch (err) {
                return { ok: false, error: errorText(err), variants: [] };
            }
        case "set-variant":
            // A different starting résumé makes an earlier tailor run stale.
            await updateSummary(msg.tabId, id => [`/api/ext/jobs/${id}`, { method: "PATCH", body: { variantId: msg.variantId } }], { tailor: null });
            return null;
        case "tailor":
            await exclusive("tailor", msg.tabId, async () => {
                const s = await getState(msg.tabId);
                if (!s.summary) return;
                const jobId = s.summary.job.id;
                await setState(msg.tabId, { tailor: { phase: "running" } });
                try {
                    const res = await api<Omit<TailorResult, "jobId">>("/api/ext/tailor", { method: "POST", body: { jobId } });
                    // Dismissed or moved to another job while it ran: drop the result.
                    const current = await getState(msg.tabId);
                    if (current.summary?.job.id !== jobId || current.tailor?.phase !== "running") return;
                    await setState(msg.tabId, { tailor: { phase: "review", result: { ...res, jobId } } });
                } catch (err) {
                    await setState(msg.tabId, { tailor: { phase: "failed", error: errorText(err) } });
                }
            });
            return null;
        case "tailor-save": {
            let saved = false;
            await exclusive("tailor-save", msg.tabId, async () => {
                const s = await getState(msg.tabId);
                const t = s.tailor;
                if (!s.summary || (t?.phase !== "review" && t?.phase !== "save-failed")) return;
                await setState(msg.tabId, { tailor: { phase: "saving", result: t.result } });
                try {
                    const res = await api<{ summary: JobSummary | null }>("/api/ext/tailor/save", {
                        method: "POST", body: { jobId: s.summary.job.id, name: msg.name, include: msg.selection.include, hidden: msg.selection.hidden },
                    });
                    await setState(msg.tabId, { summary: res.summary ?? s.summary, tailor: null });
                    saved = true;
                } catch (err) {
                    await setState(msg.tabId, { tailor: { phase: "save-failed", result: t.result, error: errorText(err) } });
                }
            });
            return { ok: saved };
        }
        case "tailor-clear":
            await setState(msg.tabId, { tailor: null });
            return null;
        case "autofill": {
            const tabId = msg.tabId;
            if ((await getState(tabId)).autofill?.phase === "running") return null;
            const autofillRun = { at: Date.now() };
            runs.set(tabId, autofillRun);
            await setState(tabId, { autofill: { phase: "running", startedAt: autofillRun.at, filled: 0, drafted: 0, attached: null, unmapped: [] } });
            try {
                await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["/content-scripts/fill.js"] });
            } catch {
                await setState(tabId, { autofill: { phase: "failed", filled: 0, drafted: 0, attached: null, unmapped: [], error: "This page can't be filled (browser pages and the Web Store are off limits)." } });
                return null;
            }
            // Frames without a form never report. getState closes a run after AUTOFILL_TIMEOUT_MS (also after a
            // worker restart); this touch pushes that change to the panel while the worker is alive.
            setTimeout(() => void setState(tabId, {}), AUTOFILL_TIMEOUT_MS + 500);
            return null;
        }
        case "autofill-data": {
            const tabId = sender.tab?.id;
            if (tabId === undefined) return { ok: false };
            const run = runs.get(tabId) ?? { at: Date.now() };
            runs.set(tabId, run);
            const jobId = await jobIdOf(tabId);
            const q = jobId ? `?jobId=${encodeURIComponent(jobId)}` : "";
            run.data ??= api<AutofillData>(`/api/ext/autofill/profile${q}`).then(r => ({ profile: r.profile, prefs: r.prefs }));
            if (msg.needPdf) run.pdf ??= apiBytes(`/api/ext/resume/pdf${q}`).then(r => ({ base64: toBase64(r.bytes), fileName: r.fileName })).catch(() => null);
            try {
                return { ok: true, data: await run.data, pdf: msg.needPdf ? await run.pdf : null };
            } catch (err) {
                const s = await getState(tabId);
                const { filled, drafted, attached, unmapped } = s.autofill ?? { filled: 0, drafted: 0, attached: null, unmapped: [] };
                await setState(tabId, { autofill: { phase: "failed", error: errorText(err), filled, drafted, attached, unmapped } });
                return { ok: false, error: errorText(err) };
            }
        }
        case "autofill-answers": {
            const tabId = sender.tab?.id;
            if (tabId === undefined) return { ok: false };
            try {
                return await api("/api/ext/autofill/answers", { method: "POST", body: { jobId: await jobIdOf(tabId), questions: msg.questions } });
            } catch (err) {
                return { ok: false, error: errorText(err) };
            }
        }
        case "autofill-report": {
            const tabId = sender.tab?.id;
            if (tabId === undefined) return null;
            const s = await getState(tabId);
            const prev = s.autofill ?? { filled: 0, drafted: 0, attached: null, unmapped: [] };
            await setState(tabId, {
                autofill: {
                    phase: "complete",
                    filled: prev.filled + msg.filled, drafted: prev.drafted + msg.drafted, attached: msg.attached ?? prev.attached,
                    unmapped: [...new Set([...prev.unmapped, ...msg.unmapped])].slice(0, 30),
                },
            });
            if (msg.unmapped.length) void api("/api/ext/autofill/unmapped", { method: "POST", body: { host: msg.host, labels: msg.unmapped } }).catch(() => undefined);
            return null;
        }
        case "connect-page":
            await chrome.tabs.create({ url: `${appUrl()}/dashboard/extension?connect=1` });
            return null;
    }
}

/** Import from LinkedIn; created when the worker starts. */
let linkedIn: LinkedInImport;

export default defineBackground(() => {
    linkedIn = createLinkedInImport({
        appOrigin: new URL(appUrl()).origin,
        // The paired account; the session refuses to run for anyone but the page's user.
        accountId: async () => (await api<{ user: { id: string } }>("/api/ext/me")).user.id,
        // The AI fallback for a profile the parser could not read (lib/profile-merge.ts).
        analyse: async (url, text) => (await api<{ data: Record<string, unknown> }>("/api/ext/profile/analyse", { method: "POST", body: { url, text } })).data,
    });
    chrome.runtime.onConnect.addListener(port => linkedIn.onConnect(port));
    // Per-tab state from earlier shapes (lib/tab-state.ts) is never read again.
    void chrome.storage.session.get(null).then(all => chrome.storage.session.remove(Object.keys(all).filter(isLegacyKey)));
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
    chrome.runtime.onMessage.addListener((msg: BgRequest, sender, sendResponse) => {
        handle(msg, sender).then(sendResponse, err => sendResponse({ ok: false, error: errorText(err) }));
        return true;
    });
    chrome.tabs.onRemoved.addListener(tabId => {
        linkedIn.onTabRemoved(tabId);
        void chrome.storage.session.remove(stateKey(tabId));
    });
    // A token revoked on the website: forget it on the next 401 (lib/api.ts) and tell open panels.
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && "token" in changes && !changes.token.newValue) {
            cachedUser = null;
            chrome.runtime.sendMessage({ type: "account-changed" }).catch(() => undefined);
        }
    });
});
