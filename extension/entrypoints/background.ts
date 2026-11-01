// Background service worker: the only place that holds the token and talks to the quikResume API.
// Keeps per-tab state (detected posting, saved job summary) in chrome.storage.session so it survives
// the worker being suspended, drives the toolbar badge, and answers the side panel / content scripts.

import { api, apiBytes, ApiError, appUrl, clearToken, getToken, setToken } from "../lib/api";
import type { AutofillData } from "../lib/fields";
import type { AccountStatus, BgRequest, JobSummary, Posting, TabState } from "../lib/types";

const EMPTY: TabState = { posting: null, summary: null, autofill: null, saving: false, error: null };
const key = (tabId: number) => `tab:${tabId}`;

async function getState(tabId: number): Promise<TabState> {
    const v = (await chrome.storage.session.get(key(tabId)))[key(tabId)] as TabState | undefined;
    return v ?? { ...EMPTY };
}

async function setState(tabId: number, patch: Partial<TabState>): Promise<TabState> {
    const next = { ...(await getState(tabId)), ...patch };
    await chrome.storage.session.set({ [key(tabId)]: next });
    await paintBadge(tabId, next);
    chrome.runtime.sendMessage({ type: "state-changed", tabId }).catch(() => undefined);
    chrome.tabs.sendMessage(tabId, { type: "tab-state", state: next }).catch(() => undefined);
    return next;
}

async function paintBadge(tabId: number, s: TabState) {
    const text = s.saving ? "…" : s.summary ? String(s.summary.score) : s.posting ? "•" : "";
    await chrome.action.setBadgeText({ tabId, text }).catch(() => undefined);
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#003200" }).catch(() => undefined);
    await chrome.action.setBadgeTextColor?.({ tabId, color: "#ffffff" }).catch(() => undefined);
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");

/** A saved job for this posting, if any (by canonical URL on the server). */
async function lookup(tabId: number, posting: Posting) {
    if (!(await getToken())) return;
    try {
        const res = await api<{ job: JobSummary | null }>(`/api/ext/jobs?url=${encodeURIComponent(posting.url)}`);
        const cur = await getState(tabId);
        if (cur.posting?.url === posting.url) await setState(tabId, { summary: res.job, error: null });
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
    if (!token) return { paired: false, user: null, appUrl: appUrl() };
    if (!cachedUser) {
        try {
            cachedUser = (await api<{ user: AccountStatus["user"] }>("/api/ext/me")).user;
        } catch (err) {
            if (err instanceof ApiError && err.status === 401) return { paired: false, user: null, appUrl: appUrl() };
        }
    }
    return { paired: true, user: cachedUser, appUrl: appUrl() };
}

async function handle(msg: BgRequest, sender: chrome.runtime.MessageSender): Promise<unknown> {
    switch (msg.type) {
        case "detected": {
            const tabId = sender.tab?.id;
            if (tabId === undefined) return null;
            const cur = await getState(tabId);
            const same = cur.posting?.url === msg.posting?.url;
            // Leaving the posting for its application form keeps the job (Auto Fill uses it); a new posting replaces it.
            const keep = same || msg.posting === null;
            const next = await setState(tabId, { posting: msg.posting, summary: keep ? cur.summary : null, error: null, saving: same ? cur.saving : false });
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
                const res = await api<{ token: string }>("/api/ext/pair", { method: "POST", body: { code: msg.code, deviceName: deviceName() }, auth: false });
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
            await setState(msg.tabId, { error: null });
            try {
                await chrome.scripting.executeScript({ target: { tabId: msg.tabId }, files: ["/content-scripts/scan.js"] });
            } catch {
                await setState(msg.tabId, { error: "This page can't be read (browser pages and the Web Store are off limits)." });
            }
            return null;
        }
        case "save": {
            const s = await getState(msg.tabId);
            if (!s.posting) return null;
            await setState(msg.tabId, { saving: true, error: null });
            try {
                const p = s.posting;
                const res = await api<{ summary: JobSummary | null }>("/api/ext/jobs", {
                    method: "POST",
                    body: { url: p.url, title: p.title, company: p.company, location: p.location, employmentType: p.employmentType, description: p.description, extractionMethod: p.method },
                });
                await setState(msg.tabId, { saving: false, summary: res.summary });
            } catch (err) {
                await setState(msg.tabId, { saving: false, error: errorText(err) });
            }
            return null;
        }
        case "refresh": {
            const s = await getState(msg.tabId);
            if (!s.summary) return null;
            try {
                const res = await api<{ summary: JobSummary }>(`/api/ext/jobs/${s.summary.job.id}`);
                await setState(msg.tabId, { summary: res.summary });
            } catch (err) {
                await setState(msg.tabId, { error: errorText(err) });
            }
            return null;
        }
        case "set-status": {
            const s = await getState(msg.tabId);
            if (!s.summary) return null;
            try {
                const res = await api<{ summary: JobSummary }>(`/api/ext/jobs/${s.summary.job.id}`, { method: "PATCH", body: { status: msg.status } });
                await setState(msg.tabId, { summary: res.summary });
            } catch (err) {
                await setState(msg.tabId, { error: errorText(err) });
            }
            return null;
        }
        case "autofill": {
            const tabId = msg.tabId;
            runs.set(tabId, { at: Date.now() });
            await setState(tabId, { autofill: { running: true, filled: 0, drafted: 0, attached: null, unmapped: [], error: null } });
            try {
                await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["/content-scripts/fill.js"] });
            } catch {
                await setState(tabId, { autofill: { running: false, filled: 0, drafted: 0, attached: null, unmapped: [], error: "This page can't be filled (browser pages and the Web Store are off limits)." } });
                return null;
            }
            // Frames without a form never report; stop the spinner after a while.
            setTimeout(async () => {
                const s = await getState(tabId);
                if (s.autofill?.running) await setState(tabId, { autofill: { ...s.autofill, running: false, error: s.autofill.filled || s.autofill.drafted ? null : "No application form found on this page." } });
            }, 45_000);
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
                await setState(tabId, { autofill: { ...(s.autofill ?? { filled: 0, drafted: 0, attached: null, unmapped: [] }), running: false, error: errorText(err) } });
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
            const prev = s.autofill ?? { running: false, filled: 0, drafted: 0, attached: null, unmapped: [], error: null };
            await setState(tabId, {
                autofill: {
                    running: false, error: null,
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

export default defineBackground(() => {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
    chrome.runtime.onMessage.addListener((msg: BgRequest, sender, sendResponse) => {
        handle(msg, sender).then(sendResponse, err => sendResponse({ ok: false, error: errorText(err) }));
        return true;
    });
    chrome.tabs.onRemoved.addListener(tabId => void chrome.storage.session.remove(key(tabId)));
    // A token revoked on the website: forget it on the next 401 (lib/api.ts) and tell open panels.
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && "token" in changes && !changes.token.newValue) {
            cachedUser = null;
            chrome.runtime.sendMessage({ type: "account-changed" }).catch(() => undefined);
        }
    });
});
