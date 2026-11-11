// Content-script side of detection: extract the posting, report it to the background (badge + side
// panel state), and show the floating button. Job boards are single-page apps (LinkedIn swaps the job
// pane without a reload), so the page is re-checked on URL changes and DOM settles.

import { extractPosting } from "./extract";
import { mountFab, type Fab } from "./fab";
import type { BgRequest, Posting, TabState } from "./types";

const send = (m: BgRequest) => chrome.runtime.sendMessage(m).catch(() => undefined);

export function runDetector(): void {
    // Injected again (a manual scan on a page the detector already watches): re-check, don't start a second one.
    const w = window as unknown as { __quikresumeDetector?: { recheck(): void } };
    if (w.__quikresumeDetector) { w.__quikresumeDetector.recheck(); return; }

    let lastKey = "";
    // The floating button: absent, being mounted (async: it reads storage), or mounted. A mount whose
    // ticket is no longer the current one lost a race (the posting went away meanwhile) and removes itself.
    let floating: { phase: "absent" } | { phase: "mounting"; ticket: object } | { phase: "mounted"; fab: Fab } = { phase: "absent" };
    // What the button shows, as last pushed by the background; applied when it mounts too.
    let shown = { score: null as number | null, saving: false };
    let timer: number | undefined;

    const currentFab = () => (floating.phase === "mounted" ? floating.fab : null);

    async function check(force = false) {
        const posting: Posting | null = extractPosting(document, location.href);
        const key = posting ? `${posting.url}|${posting.title}|${posting.description.length > 0}` : "";
        if (!force && key === lastKey) return;
        lastKey = key;
        await send({ type: "detected", posting });
        if (!posting) {
            currentFab()?.remove();
            floating = { phase: "absent" };
            return;
        }
        if (floating.phase === "absent") {
            const ticket = {};
            floating = { phase: "mounting", ticket };
            const fab = await mountFab(() => void send({ type: "open-panel" }));
            if (floating.phase !== "mounting" || floating.ticket !== ticket) {
                fab?.remove();
                return;
            }
            floating = fab ? { phase: "mounted", fab } : { phase: "absent" };
        }
        currentFab()?.update(shown);
        currentFab()?.pulse();
    }

    w.__quikresumeDetector = { recheck: () => void check(true) };

    const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(() => void check(), 700); };
    let href = location.href;
    new MutationObserver(() => {
        if (location.href !== href) { href = location.href; lastKey = ""; }
        schedule();
    }).observe(document.documentElement, { childList: true, subtree: true });
    schedule();

    // The background pushes the saved job's score so the button can show it.
    chrome.runtime.onMessage.addListener((m: { type?: string; state?: TabState }) => {
        if (m?.type === "tab-state" && m.state) {
            shown = { score: m.state.summary?.score ?? null, saving: m.state.save.phase === "saving" };
            currentFab()?.update(shown);
        }
        if (m?.type === "rescan") void check(true);
    });
}
