// Side panel card for Import from LinkedIn, shown on the session's LinkedIn tab. The session itself lives
// in the background (lib/linkedin-session.ts): this card reads it, follows the tab's address through tab
// events, and asks for the capture. Import is enabled only when the tab is the expected profile. While the
// background reads an unrecognised page with AI the card shows "Reading with AI…".

import { useEffect, useState } from "react";
import { canonicalProfileUrl } from "../../../src/lib/import/linkedin";
import type { LinkedInRequest, LinkedInState, ProfilePageReply, ProfileTabRequest } from "../../lib/linkedin-session";

const send = <T,>(m: LinkedInRequest) => chrome.runtime.sendMessage(m) as Promise<T>;
const display = (url: string) => url.replace(/^https:\/\/(www\.)?/, "");

/** The background's LinkedIn session, kept current by its "linkedin-changed" broadcasts. */
export function useLinkedInSession(): LinkedInState {
    const [state, setState] = useState<LinkedInState>({ phase: "idle" });
    useEffect(() => {
        let active = true;
        const load = () => void send<LinkedInState>({ type: "linkedin-state" }).then(s => { if (active && s) setState(s); }).catch(() => undefined);
        load();
        const onMessage = (m: { type?: string }) => { if (m?.type === "linkedin-changed") load(); };
        chrome.runtime.onMessage.addListener(onMessage);
        return () => { active = false; chrome.runtime.onMessage.removeListener(onMessage); };
    }, []);
    return state;
}

type TabPage = { url: string; loginWall: boolean | null };

/** The tab's address and whether it shows LinkedIn's login wall, re-read on every navigation. */
function useTabPage(tabId: number): TabPage | null {
    const [page, setPage] = useState<TabPage | null>(null);
    useEffect(() => {
        let active = true;
        const read = async () => {
            const tab = await chrome.tabs.get(tabId).catch(() => null);
            const probe: ProfileTabRequest = { type: "profile-page" };
            const reply = (await chrome.tabs.sendMessage(tabId, probe).catch(() => null)) as ProfilePageReply | null;
            if (active) setPage({ url: tab?.url ?? "", loginWall: reply ? reply.loginWall : null });
        };
        void read();
        const onUpdated = (id: number, info: { url?: string; status?: string }) => {
            if (id === tabId && (info.url || info.status === "complete")) void read();
        };
        chrome.tabs.onUpdated.addListener(onUpdated);
        return () => { active = false; chrome.tabs.onUpdated.removeListener(onUpdated); };
    }, [tabId]);
    return page;
}

/** True when the session belongs on this tab (the panel then shows only this card). */
export function onSessionTab(state: LinkedInState, tabId: number): boolean {
    return state.phase !== "idle" && state.phase !== "opening" && state.tabId === tabId;
}

export function LinkedInImportCard({ state, tabId }: { state: LinkedInState; tabId: number }) {
    const page = useTabPage(tabId);
    if (state.phase === "idle" || state.phase === "opening") return null;

    if (state.phase === "done") {
        return (
            <div className="card stack li-done" role="status">
                <span className="done-mark" aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                </span>
                <h2>Profile sent to quikResume</h2>
                <p className="muted">Review it on the Import page in quikResume.</p>
                <button className="btn ghost" onClick={() => void send({ type: "linkedin-dismiss" })}>Done</button>
            </div>
        );
    }

    if (state.phase === "ended") {
        return (
            <div className="card stack">
                <h2>Import from LinkedIn</h2>
                <div className="notice err" role="alert">{state.error}</div>
                <button className="btn" onClick={() => void send({ type: "linkedin-dismiss" })}>Dismiss</button>
            </div>
        );
    }

    const current = page ? canonicalProfileUrl(page.url) : null;
    const matches = current === state.url;
    const loginWall = page?.loginWall === true || (page !== null && /linkedin\.com\/(authwall|login|checkpoint|uas)/.test(page.url));
    const working = state.phase === "capturing" || state.phase === "analysing" || state.phase === "sending";
    const canImport = state.phase === "waiting" && matches && !loginWall;
    const steps = [
        { label: "Sign in to LinkedIn", done: page !== null && !loginWall && page.url.includes("linkedin.com") },
        { label: "Open your profile", done: matches },
        { label: "Click Import", done: working },
    ];

    return (
        <div className="card stack">
            <h2>Import from LinkedIn</h2>
            <ol className="steps">
                {steps.map((step, i) => (
                    <li key={step.label} className={step.done ? "done" : ""}>
                        <span className="dot" aria-hidden="true">{step.done ? "✓" : i + 1}</span>{step.label}
                    </li>
                ))}
            </ol>
            <dl className="urls">
                <dt>Your profile</dt>
                <dd>{display(state.url)}</dd>
                <dt>This tab</dt>
                <dd className={matches ? "ok" : "err"}>{page ? display(current ?? page.url) || "—" : "…"}</dd>
            </dl>

            {loginWall ? (
                <div className="notice err" role="alert">Sign in to LinkedIn, open your profile, then click Import.</div>
            ) : page && !matches ? (
                <div className="notice err" role="alert">
                    This tab is not the LinkedIn profile saved in quikResume.{" "}
                    <button className="link" onClick={() => void chrome.tabs.update(tabId, { url: state.url })}>Open my profile</button>
                </div>
            ) : null}
            {state.phase === "waiting" && state.error && <div className="notice err" role="alert">{state.error}</div>}
            {state.phase === "analysing" && <p className="muted" role="status">Some sections needed AI to read. This takes a few seconds.</p>}

            <button className="btn primary block" disabled={!canImport} onClick={() => void send({ type: "linkedin-capture", id: state.id })}>
                {state.phase === "capturing" ? <><span className="spinner" /> Reading your profile…</>
                    : state.phase === "analysing" ? <><span className="spinner" /> Reading with AI…</>
                    : state.phase === "sending" ? <><span className="spinner" /> Sending to quikResume…</>
                        : state.phase === "waiting" && state.error ? "Try again" : "Import"}
            </button>
            <p className="subtle">Reads your profile in your browser, including its “Show all” lists. Parts it can't read directly are read with AI through quikResume.</p>
        </div>
    );
}
