// Content-script side of detection: extract the posting, report it to the background (badge + side
// panel state), and show the floating button. Job boards are single-page apps (LinkedIn swaps the job
// pane without a reload), so the page is re-checked on URL changes and DOM settles.

import { extractPosting } from "./extract";
import { mountFab, type Fab } from "./fab";
import type { BgRequest, Posting, TabState } from "./types";

const send = (m: BgRequest) => chrome.runtime.sendMessage(m).catch(() => undefined);

export function runDetector(): void {
    const w = window as unknown as { __quikresumeDetector?: boolean };
    if (w.__quikresumeDetector) { void check(true); return; }
    w.__quikresumeDetector = true;

    let lastKey = "";
    let floating: { phase: "absent" } | { phase: "mounting"; ticket: object } | { phase: "mounted"; fab: Fab } = { phase: "absent" };
    const currentFab = () => floating.phase === "mounted" ? floating.fab : null;
    let timer: number | undefined;

    async function check(force = false) {
        const posting: Posting | null = extractPosting(document, location.href);
        const key = posting ? `${posting.url}|${posting.title}|${posting.description.length > 0}` : "";
        if (!force && key === lastKey) return;
        lastKey = key;
        await send({ type: "detected", posting });
        if (key !== lastKey) return;
        if (!posting) { currentFab()?.remove(); floating = { phase: "absent" }; return; }
        if (floating.phase === "absent") {
            const ticket = {};
            floating = { phase: "mounting", ticket };
            const fab = await mountFab(() => void send({ type: "open-panel" }));
            if (floating.phase !== "mounting" || floating.ticket !== ticket || key !== lastKey) { fab?.remove(); return; }
            floating = fab ? { phase: "mounted", fab } : { phase: "absent" };
        }
        currentFab()?.update({ score: null, saving: false });
        currentFab()?.bounce();
    }

    const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(() => void check(), 700); };
    let href = location.href;
    new MutationObserver(() => {
        if (location.href !== href) { href = location.href; lastKey = ""; }
        schedule();
    }).observe(document.documentElement, { childList: true, subtree: true });
    schedule();

    // The background pushes the saved job's score so the button can show it.
    chrome.runtime.onMessage.addListener((m: { type?: string; state?: TabState }) => {
        if (m?.type === "tab-state" && m.state) currentFab()?.update({ score: m.state.summary?.score ?? null, saving: m.state.operation.phase === "saving" });
        if (m?.type === "rescan") void check(true);
    });
}
