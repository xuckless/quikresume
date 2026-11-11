// Side panel: connect the account, see the posting on the active tab, save it (save + analyse +
// background AI check), and read the match: score ± band, must-haves, what would raise it, tracker
// status. The panel follows the active tab.

import { useEffect, useState } from "react";
import { JOB_STATUSES, JOB_STATUS_LABEL, type AccountStatus, type BgRequest, type JobStatus, type JobSummary, type TabState } from "../../lib/types";
import { ProfileImportCard } from "./ProfileImportCard";
import { AutofillCard } from "./AutofillCard";
import { ResumePicker, TailorCard } from "./TailorCard";

const send = <T,>(m: BgRequest) => chrome.runtime.sendMessage(m) as Promise<T>;

function Bolt({ size = 20 }: { size?: number }) {
    return (
        <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
            <circle cx="12.5" cy="12.5" r="7.25" fill="none" stroke="currentColor" strokeWidth="3.5" />
            <path d="M18.5 4.5h3.75V18H26l-7.5 12 1.4-8h-3.3l1.9-4z" fill="currentColor" />
        </svg>
    );
}

function band(score: number) {
    return score >= 80 ? "Strong fit" : score >= 60 ? "Good fit" : score >= 40 ? "Partial fit" : "Weak fit";
}

function Ring({ score }: { score: number }) {
    const r = 27;
    const c = 2 * Math.PI * r;
    return (
        <div className="ring" aria-label={`Match score ${score} of 100`}>
            <svg width="64" height="64" viewBox="0 0 64 64">
                <circle cx="32" cy="32" r={r} fill="none" stroke="var(--chart-track)" strokeWidth="6" />
                <circle cx="32" cy="32" r={r} fill="none" stroke="var(--accent-text)" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(c * score) / 100} ${c}`} />
            </svg>
            <span>{score}</span>
        </div>
    );
}

function useActiveTab(): number | null {
    const [tabId, setTabId] = useState<number | null>(null);
    useEffect(() => {
        const read = () => chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => setTabId(t?.id ?? null));
        void read();
        const onActivated = () => void read();
        chrome.tabs.onActivated.addListener(onActivated);
        return () => chrome.tabs.onActivated.removeListener(onActivated);
    }, []);
    return tabId;
}

function Connect({ appUrl }: { appUrl: string }) {
    const [code, setCode] = useState("");
    const [pairing, setPairing] = useState<{ phase: "idle" | "pairing" | "paired"; error?: never } | { phase: "failed"; error: string }>({ phase: "idle" });
    const busy = pairing.phase === "pairing";
    const error = pairing.error;
    const pair = async () => {
        if (busy) return;
        setPairing({ phase: "pairing" });
        try {
            const res = await send<{ ok: boolean; error?: string }>({ type: "pair", code });
            setPairing(res?.ok ? { phase: "paired" } : { phase: "failed", error: res?.error ?? "That didn't work." });
        } catch {
            setPairing({ phase: "failed", error: "Couldn't reach the extension. Reload it and try again." });
        }
    };
    return (
        <div className="card stack">
            <h2>Connect your quikResume account</h2>
            <a className="btn primary block" href={`${appUrl}/login`} target="_blank" rel="noreferrer">Create a quikResume account or sign in</a>
            <p className="subtle">After signing in, click Connect below to pair this browser.</p>
            <p className="muted" style={{ margin: 0 }}>Save jobs from any board, see how your résumé matches, and fill applications.</p>
            <button className="btn primary block" onClick={() => void send({ type: "connect-page" })}>Connect</button>
            <p className="subtle" style={{ margin: "4px 0 0" }}>Or type the code from <a href={`${appUrl}/dashboard/extension`} target="_blank" rel="noreferrer">quikResume → Extension</a>:</p>
            <div className="row">
                <input className="code" value={code} maxLength={9} placeholder="ABCD-EFGH" aria-label="Connection code" onChange={e => setCode(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && code.trim()) void pair(); }} />
                <button className="btn" disabled={busy || code.replace(/[^a-z0-9]/gi, "").length !== 8} onClick={() => void pair()}>{busy ? <span className="spinner" /> : "Connect"}</button>
            </div>
            {error && <p className="err" style={{ margin: 0 }}>{error}</p>}
        </div>
    );
}

function Summary({ s, tabId, appUrl, state }: { s: JobSummary; tabId: number; appUrl: string; state: TabState | null }) {
    const running = s.job.match.status === "running";
    // While the AI check runs in the background, re-read the summary every 5 s.
    useEffect(() => {
        if (!running) return;
        const t = window.setInterval(() => void send({ type: "refresh", tabId }), 5000);
        return () => window.clearInterval(t);
    }, [running, tabId]);
    const jobLink = `${appUrl}/dashboard?view=jobs&job=${encodeURIComponent(s.job.id)}`;
    return (
        <>
            <div className="card stack">
                <div className="score">
                    <Ring score={s.score} />
                    <div>
                        <div style={{ fontWeight: 600 }}>{band(s.score)} <span className="mono subtle">±{s.band}</span></div>
                        <div>Must-haves <span className="mono">{s.must.hit}/{s.must.total}</span>{s.nice.total > 0 && <span className="subtle"> · nice {s.nice.hit}/{s.nice.total}</span>}</div>
                        <div className="subtle">On: {s.resume.name}</div>
                    </div>
                </div>
                {running && <div className="row subtle"><span className="spinner" /> AI check running; the score may still change.</div>}
                {s.job.match.warning && !running && <div className="notice">{s.job.match.warning}</div>}
                {s.gated && <div className="notice">Capped at 70: a hard must-have is missing.</div>}
                {s.missingMust.length > 0 && (
                    <div><div className="subtle">Missing must-haves</div><div className="err">{s.missingMust.join(", ")}</div></div>
                )}
            </div>

            {s.whatIf.length > 0 && (
                <div className="card stack">
                    <h2>What would raise it</h2>
                    <ul className="plain">
                        {s.whatIf.map(w => (
                            <li key={w.display} className="row between">
                                <span>Show <strong>{w.display}</strong> <span className="subtle">· {w.importance}</span></span>
                                <span className="mono gain">+{w.gain.toFixed(w.gain < 10 ? 1 : 0)}</span>
                            </li>
                        ))}
                    </ul>
                    <a href={jobLink} target="_blank" rel="noreferrer">Open the full review →</a>
                </div>
            )}

            <TailorCard s={s} tabId={tabId} state={state} />

            <div className="card stack">
                <ResumePicker s={s} tabId={tabId} />
                <div className="row between">
                <label htmlFor="status" className="muted">Tracker status</label>
                <select id="status" value={s.job.status} onChange={e => void send({ type: "set-status", tabId, status: e.target.value as JobStatus })}>
                    {JOB_STATUSES.map(st => <option key={st} value={st}>{JOB_STATUS_LABEL[st]}</option>)}
                </select>
                </div>
            </div>
        </>
    );
}

export function App() {
    const tabId = useActiveTab();
    const [availability, setAvailability] = useState<{ phase: "checking" } | { phase: "ready" | "login-required"; account: AccountStatus }>({ phase: "checking" });
    const account = availability.phase === "checking" ? null : availability.account;
    const [state, setState] = useState<TabState | null>(null);
    const [fabEnabled, setFabEnabled] = useState(true);

    useEffect(() => {
        // If the background worker can't answer, fall back to the Connect screen instead of "Loading…" forever.
        const load = () => void send<AccountStatus>({ type: "status" }).then(account => setAvailability({ phase: account.paired ? "ready" : "login-required", account })).catch(() => setAvailability({ phase: "login-required", account: { paired: false, user: null, appUrl: "" } }));
        load();
        void chrome.storage.local.get("fabEnabled").then(v => setFabEnabled(v.fabEnabled !== false));
        const onMsg = (m: { type?: string }) => { if (m?.type === "account-changed") load(); };
        chrome.runtime.onMessage.addListener(onMsg);
        return () => chrome.runtime.onMessage.removeListener(onMsg);
    }, []);

    useEffect(() => {
        setState(null);
        if (tabId === null) return;
        let active = true;
        const load = () => void send<TabState>({ type: "tab-state", tabId }).then(next => { if (active) setState(next); });
        load();
        const onMsg = (m: { type?: string; tabId?: number }) => { if (m?.type === "state-changed" && m.tabId === tabId) load(); };
        chrome.runtime.onMessage.addListener(onMsg);
        return () => { active = false; chrome.runtime.onMessage.removeListener(onMsg); };
    }, [tabId]);

    const appUrl = account?.appUrl ?? "";
    const posting = state?.posting ?? null;

    return (
        <>
            <header>
                <span className="brand"><Bolt />quik<span className="r">R</span>esume</span>
                {account?.paired && (
                    <button className="btn ghost" title={account.user?.email ?? ""} onClick={() => { if (confirm("Disconnect this browser from quikResume?")) void send({ type: "signout" }); }}>Disconnect</button>
                )}
            </header>
            <main>
                {!account ? (
                    <div className="row subtle"><span className="spinner" /> Loading…</div>
                ) : !account.paired ? (
                    <Connect appUrl={appUrl} />
                ) : tabId === null ? (
                    <div className="card"><p className="muted" style={{ margin: 0 }}>No active tab. Open a page to get started.</p></div>
                ) : (
                    <>
                        {state?.profileImport && <ProfileImportCard state={state.profileImport} tabId={tabId} />}
                        {state?.operation.error && <div className="notice err">{state.operation.error}</div>}
                        {!posting ? (
                            <div className="card stack">
                                <h2>No job posting found</h2>
                                <p className="muted" style={{ margin: 0 }}>Open a job on LinkedIn, Indeed, Glassdoor, Greenhouse, Lever, Ashby, Workday and others, or scan this page.</p>
                                <button className="btn" onClick={() => void send({ type: "scan", tabId })}>Scan this page</button>
                            </div>
                        ) : (
                            <div className="card stack">
                                <div>
                                    <h2>{posting.title}</h2>
                                    <div className="muted">{[posting.company, posting.location].filter(Boolean).join(" · ") || posting.site}</div>
                                </div>
                                {!state?.summary && (
                                    <button className="btn primary block" disabled={state?.operation.phase === "saving"} onClick={() => void send({ type: "save", tabId })}>
                                        {state?.operation.phase === "saving" ? <><span className="spinner" /> Saving and matching…</> : "Save job & see match"}
                                    </button>
                                )}
                                {state?.summary && <div className="subtle">Saved to your Job Tracker.</div>}
                            </div>
                        )}
                        {state?.summary && <Summary s={state.summary} tabId={tabId} appUrl={appUrl} state={state} />}
                        <AutofillCard tabId={tabId} summary={state?.summary ?? null} state={state} appUrl={appUrl} />
                        <div className="card switch">
                            <span className="muted">Floating button on job pages</span>
                            <input type="checkbox" checked={fabEnabled} aria-label="Floating button on job pages" onChange={e => { setFabEnabled(e.target.checked); void chrome.storage.local.set({ fabEnabled: e.target.checked }); }} />
                        </div>
                    </>
                )}
            </main>
            <footer>AI can make mistakes. Please review the work before applying.</footer>
        </>
    );
}
