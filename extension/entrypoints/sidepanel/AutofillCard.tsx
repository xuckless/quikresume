// Auto Fill: fills the application form on the active tab from the profile, Autofill preferences and
// the job's résumé (linked variant, else working selection), drafts open questions with AI, attaches
// the PDF. Filled fields are outlined; AI drafts get a dashed outline. Nothing is submitted.
import type { BgRequest, JobSummary, TabState } from "../../lib/types";

const send = (m: BgRequest) => chrome.runtime.sendMessage(m);

export function AutofillCard({ tabId, summary, state, appUrl }: { tabId: number; summary: JobSummary | null; state: TabState | null; appUrl: string }) {
    const r = state?.autofill ?? null;
    return (
        <div className="card stack">
            <div>
                <h2>Auto Fill</h2>
                <div className="subtle">
                    {summary ? <>For <strong>{summary.job.title}</strong> · résumé: {summary.resume.name}</> : "Save the job first to tailor answers to it, or fill with your working selection."}
                </div>
            </div>
            <button className="btn primary block" disabled={r?.phase === "running"} onClick={() => void send({ type: "autofill", tabId })}>
                {r?.phase === "running" ? <><span className="spinner" /> Filling…</> : "Auto Fill"}
            </button>
            {r && r.phase === "complete" && !r.error && (
                <div className="stack" style={{ gap: 4 }}>
                    <div>Filled <span className="mono">{r.filled}</span>{r.drafted > 0 && <> · AI drafts <span className="mono">{r.drafted}</span> <span className="subtle">(dashed outline)</span></>}</div>
                    {r.attached && <div className="subtle">Attached {r.attached}</div>}
                    {r.unmapped.length > 0 && (
                        <div>
                            <div className="subtle">Left for you ({r.unmapped.length}):</div>
                            <ul className="plain subtle">{r.unmapped.slice(0, 8).map(u => <li key={u}>· {u}</li>)}</ul>
                            <a href={`${appUrl}/dashboard/autofill`} target="_blank" rel="noreferrer">Add answers in Autofill preferences →</a>
                        </div>
                    )}
                    <div className="notice">Review every field before you submit. quikResume never submits for you.</div>
                </div>
            )}
            {r?.error && <div className="notice err">{r.error}</div>}
        </div>
    );
}
