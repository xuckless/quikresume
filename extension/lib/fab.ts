// The in-page floating button (Honey-style): a q⚡ disc bottom-right that gives one ring pulse when a
// posting is detected and shows the match score once the job is saved. Lives in a closed shadow root so page CSS
// can't touch it. Dismissal is per site (chrome.storage.local "fabHidden": host[]); a global switch
// ("fabEnabled") is in the side panel. Motion follows the app's system (src/app/globals.css): ease-out
// curve, press 0.97 over 120 ms, one success ring pulse (0 -> 7px, 520 ms), nothing under reduced motion.

const BOLT = '<svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true"><circle cx="12.5" cy="12.5" r="7.25" fill="none" stroke="currentColor" stroke-width="3.5"/><path d="M18.5 4.5h3.75V18H26l-7.5 12 1.4-8h-3.3l1.9-4z" fill="currentColor"/></svg>';

const CSS = `
:host { all: initial; --ease-out: cubic-bezier(0.23, 1, 0.32, 1); }
.wrap { position: fixed; right: 20px; bottom: 24px; z-index: 2147483646; display: flex; align-items: center; gap: 6px;
  font: 500 12px/1 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
.btn { display: inline-flex; align-items: center; gap: 8px; height: 44px; min-width: 44px; padding: 0 12px; border-radius: 22px;
  border: 0; background: #003200; color: #fff; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,.2), 0 4px 12px rgba(0,50,0,.25);
  transition: transform 120ms var(--ease-out); }
.btn:active { transform: scale(0.97); }
.btn:focus-visible { outline: 2px solid #5fd38a; outline-offset: 2px; }
.btn .label { font-size: 13px; letter-spacing: .01em; }
.btn .score { font: 600 13px/1 ui-monospace, "SF Mono", Menlo, monospace; background: rgba(255,255,255,.14); padding: 4px 6px; border-radius: 6px; }
.x { width: 22px; height: 22px; border-radius: 11px; border: 1px solid rgba(0,0,0,.12); background: #fff; color: #444; cursor: pointer;
  font-size: 14px; line-height: 1; opacity: 0; transition: opacity 150ms var(--ease-out); }
.wrap:hover .x, .x:focus-visible { opacity: 1; }
@keyframes pulse { from { box-shadow: 0 0 0 0 rgba(95,211,138,.55), 0 1px 2px rgba(0,0,0,.2), 0 4px 12px rgba(0,50,0,.25); }
  to { box-shadow: 0 0 0 7px rgba(95,211,138,0), 0 1px 2px rgba(0,0,0,.2), 0 4px 12px rgba(0,50,0,.25); } }
.pulse .btn { animation: pulse 520ms var(--ease-out) 1; }
@media (prefers-reduced-motion: reduce) { .btn, .x { transition: none; } .pulse .btn { animation: none; } .btn:active { transform: none; } }
`;

export interface Fab {
    update(state: { score: number | null; saving: boolean }): void;
    /** One ring pulse: a posting was detected. */
    pulse(): void;
    remove(): void;
}

export async function mountFab(onClick: () => void): Promise<Fab | null> {
    const host = location.hostname;
    const { fabEnabled = true, fabHidden = [] } = (await chrome.storage.local.get(["fabEnabled", "fabHidden"])) as { fabEnabled?: boolean; fabHidden?: string[] };
    if (!fabEnabled || fabHidden.includes(host)) return null;

    const el = document.createElement("quikresume-fab");
    const root = el.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>${CSS}</style><div class="wrap"><button class="x" title="Hide on this site" aria-label="Hide quikResume on this site">×</button><button class="btn" aria-label="Open quikResume">${BOLT}<span class="label">Match</span></button></div>`;
    const wrap = root.querySelector<HTMLDivElement>(".wrap")!;
    const label = root.querySelector<HTMLSpanElement>(".label")!;
    root.querySelector(".btn")!.addEventListener("click", onClick);
    root.querySelector(".x")!.addEventListener("click", async () => {
        el.remove();
        const cur = ((await chrome.storage.local.get("fabHidden")).fabHidden as string[] | undefined) ?? [];
        await chrome.storage.local.set({ fabHidden: [...new Set([...cur, host])] });
    });
    document.documentElement.appendChild(el);

    return {
        update({ score, saving }) {
            label.className = score === null ? "label" : "score";
            label.textContent = saving ? "Saving…" : score === null ? "Match" : String(score);
        },
        pulse() {
            wrap.classList.remove("pulse");
            void wrap.offsetWidth;
            wrap.classList.add("pulse");
        },
        remove() { el.remove(); },
    };
}
