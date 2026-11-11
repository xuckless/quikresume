// Side panel: which résumé this job uses (linked variant or the working selection) and a quick tailor:
// the same plan as the web Tailor window, trimmed to one page on the server, shown as suggestions the
// user ticks; "Save" stores the result as a variant linked to the job (Auto Fill then attaches it).

import { useEffect, useState } from "react";
import { applySuggestions, type BgRequest, type JobSummary, type TabState, type TailorSuggestion, type VariantInfo } from "../../lib/types";

const send = <T,>(m: BgRequest) => chrome.runtime.sendMessage(m) as Promise<T>;

export function ResumePicker({ s, tabId }: { s: JobSummary; tabId: number }) {
    const [variants, setVariants] = useState<VariantInfo[] | null>(null);
    useEffect(() => {
        void send<{ variants: VariantInfo[] }>({ type: "variants" }).then(r => setVariants(r?.variants ?? []));
    }, [s.job.variantId]);
    const value = s.job.variantId ?? "";
    return (
        <div className="row between">
            <label htmlFor="resume" className="muted">Résumé for this job</label>
            <select id="resume" value={value} disabled={!variants} onChange={e => void send({ type: "set-variant", tabId, variantId: e.target.value || null })}>
                <option value="">Working selection</option>
                {variants?.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                {variants && value && !variants.some(v => v.id === value) && <option value={value}>{s.resume.name}</option>}
            </select>
        </div>
    );
}

function describe(x: TailorSuggestion): string {
    if (x.kind === "item") return `${x.include ? "Add" : "Remove"} ${x.label}`;
    const line = x.key.length > 70 ? `${x.key.slice(0, 70)}…` : x.key;
    return `${x.hide ? "Hide" : "Show"} “${line}” (${x.label})`;
}

export function TailorCard({ s, tabId, state }: { s: JobSummary; tabId: number; state: TabState | null }) {
    const t = state?.tailor ?? null;
    const result = t?.result && t.result.jobId === s.job.id ? t.result : null;
    const [off, setOff] = useState<Record<string, boolean>>({});
    const [name, setName] = useState("");
    const resultKey = result ? `${result.jobId}:${result.suggestions.length}:${result.after}` : "";
    useEffect(() => { setOff({}); }, [resultKey]);

    if (!result) {
        return (
            <div className="card stack">
                <h2>Quick tailor</h2>
                <p className="muted" style={{ margin: 0 }}>Pick the items and lines that fit this job, trimmed to one page. Nothing changes until you save.</p>
                {t?.error && <p className="err" style={{ margin: 0 }}>{t.error}</p>}
                <button className="btn primary block" disabled={t?.phase === "running"} onClick={() => void send({ type: "tailor", tabId })}>
                    {t?.phase === "running" ? <><span className="spinner" /> Tailoring… (up to 2 min)</> : "Tailor my résumé for this job"}
                </button>
            </div>
        );
    }

    const chosen = result.suggestions.filter(x => !off[x.id]);
    const save = () => void send({ type: "tailor-save", tabId, name: name.trim() || `${s.job.title}${s.job.company ? ` · ${s.job.company}` : ""}`, selection: applySuggestions(result.base, chosen) });
    return (
        <div className="card stack">
            <div className="row between">
                <h2>Quick tailor</h2>
                <button className="btn ghost" onClick={() => void send({ type: "tailor-clear", tabId })}>Close</button>
            </div>
            <div className="muted">
                From {result.source.name}: score <span className="mono">{result.before}</span> → <span className="mono gain">{result.after}</span>
                {result.pages > 0 && <> · {result.pages === 1 ? "fits one page" : `${result.pages} pages`}</>}
            </div>
            {result.warning && <div className="notice">{result.warning}</div>}
            {result.suggestions.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>Your résumé already fits this job; nothing to change.</p>
            ) : (
                <ul className="plain stack">
                    {result.suggestions.map(x => (
                        <li key={x.id}>
                            <label className="row" style={{ alignItems: "flex-start", gap: 8 }}>
                                <input type="checkbox" checked={!off[x.id]} onChange={e => setOff(o => ({ ...o, [x.id]: !e.target.checked }))} />
                                <span>
                                    <span>{describe(x)}</span>
                                    <span className="subtle" style={{ display: "block" }}>{x.reason}</span>
                                </span>
                            </label>
                        </li>
                    ))}
                </ul>
            )}
            <input className="text" value={name} maxLength={80} placeholder={`${s.job.title}${s.job.company ? ` · ${s.job.company}` : ""}`} aria-label="Name for the tailored résumé" onChange={e => setName(e.target.value)} />
            {t?.error && <p className="err" style={{ margin: 0 }}>{t.error}</p>}
            <button className="btn primary block" disabled={t?.phase === "saving"} onClick={save}>
                {t?.phase === "saving" ? <><span className="spinner" /> Saving…</> : "Save as the résumé for this job"}
            </button>
            <p className="subtle" style={{ margin: 0 }}>Saved to Variants and linked to this job; Auto Fill attaches it.</p>
        </div>
    );
}
