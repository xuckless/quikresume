// Background service worker: the only place that holds the token and talks to the quikResume API.
// Keeps per-tab state (detected posting, saved job summary) in chrome.storage.session so it survives
// the worker being suspended, drives the toolbar badge, and answers the side panel / content scripts.

import { api, ApiError, appUrl, clearToken, getToken, setToken } from "../lib/api";
import type { AccountStatus, BgRequest, JobSummary, Posting, TabState } from "../lib/types";

const EMPTY: TabState = { posting: null, summary: null, saving: false, error: null };
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
            const next = await setState(tabId, { posting: msg.posting, summary: same ? cur.summary : null, error: null, saving: same ? cur.saving : false });
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
