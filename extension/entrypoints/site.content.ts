// Runs only on the quikResume app. Relays between the page and the background worker
// (contract and validation: src/lib/ext/bridge.ts in the app):
//   ping -> hello (version, paired, LinkedIn import supported); pair -> the background redeems the code;
//   linkedin-* -> a "linkedin-import" port to the background, whose replies are posted back to the page;
//   the port closes when the session ends (cancel from the page, or "linkedin-ended" from the background).
// When the extension is reloaded this script is orphaned: it reports "disconnected" so the page can ask
// for a reload.
import { EXT_SOURCE, LINKEDIN_PORT, readAppMessage, type ExtPayload } from "../../src/lib/ext/bridge";
import type { AccountStatus } from "../lib/types";

const appOrigin = new URL(__APP_URL__).origin;
/** Messages on an open port keep the background worker alive while the user is on LinkedIn. */
const KEEPALIVE_MS = 20_000;

export default defineContentScript({
    matches: [`${appOrigin}/*`],
    runAt: "document_start",
    main() {
        const reply = (payload: ExtPayload) => window.postMessage({ source: EXT_SOURCE, ...payload }, location.origin);
        const extensionAlive = () => Boolean(chrome.runtime?.id);
        const hello = async () => {
            const status = (await chrome.runtime.sendMessage({ type: "status" }).catch(() => null)) as AccountStatus | null;
            reply({ type: "hello", version: chrome.runtime.getManifest().version, paired: Boolean(status?.paired), linkedIn: true });
        };

        let link: { port: chrome.runtime.Port; keepalive: ReturnType<typeof setInterval> } | null = null;
        const close = () => {
            if (!link) return;
            clearInterval(link.keepalive);
            link.port.disconnect();
            link = null;
        };
        const portToBackground = (): chrome.runtime.Port => {
            if (link) return link.port;
            const port = chrome.runtime.connect({ name: LINKEDIN_PORT });
            const keepalive = setInterval(() => {
                try {
                    port.postMessage({ type: "keepalive" });
                } catch { /* onDisconnect reports it */ }
            }, KEEPALIVE_MS);
            link = { port, keepalive };
            // The background only posts LinkedInExtPayload; the page validates it again.
            port.onMessage.addListener((m: ExtPayload) => {
                reply(m);
                if (m.type === "linkedin-ended") close();
            });
            port.onDisconnect.addListener(() => {
                if (link?.port !== port) return;
                clearInterval(keepalive);
                link = null;
                reply({ type: "disconnected" });
            });
            return port;
        };
        window.addEventListener("pagehide", close);

        window.addEventListener("message", async e => {
            const m = readAppMessage(e);
            if (!m) return;
            if (!extensionAlive()) {
                reply({ type: "disconnected" });
                return;
            }
            switch (m.type) {
                case "ping":
                    await hello();
                    return;
                case "pair": {
                    const res = (await chrome.runtime.sendMessage({ type: "pair", code: m.code }).catch(() => null)) as { ok: boolean; error?: string } | null;
                    reply(res?.ok ? { type: "paired", ok: true } : { type: "paired", ok: false, error: res?.error ?? "The extension did not answer." });
                    return;
                }
                default:
                    // A cancel for a session this page never started needs no port.
                    if (m.type === "linkedin-cancel" && !link) return;
                    try {
                        portToBackground().postMessage(m);
                        if (m.type === "linkedin-cancel") close();
                    } catch {
                        close();
                        reply({ type: "disconnected" });
                    }
            }
        });
        void hello();
    },
});
