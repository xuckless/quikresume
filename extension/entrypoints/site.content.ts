// Runs only on the quikResume app. Bridges /dashboard/extension and the background worker:
// answers "ping" with "hello" and forwards one-time pairing codes (src/lib/ext/bridge.ts in the app).
import { APP_SOURCE, EXT_SOURCE, type AccountStatus } from "../lib/types";

const appOrigin = new URL(__APP_URL__).origin;

export default defineContentScript({
    matches: [`${appOrigin}/*`],
    runAt: "document_start",
    main() {
        const reply = (data: object) => window.postMessage({ source: EXT_SOURCE, ...data }, location.origin);
        const hello = async () => {
            const status = (await chrome.runtime.sendMessage({ type: "status" }).catch(() => null)) as AccountStatus | null;
            reply({ type: "hello", version: chrome.runtime.getManifest().version, paired: Boolean(status?.paired), profileImport: true });
        };
        let port: chrome.runtime.Port | undefined;
        const connect = () => {
            if (port) return port;
            const next = chrome.runtime.connect({ name: "profile-import" });
            port = next;
            next.onMessage.addListener(m => reply(m));
            next.onDisconnect.addListener(() => {
                if (port !== next) return;
                port = undefined;
                reply({ type: "profile-error", error: "Extension disconnected. Restart the import." });
            });
            return next;
        };
        window.addEventListener("pagehide", () => { port?.disconnect(); port = undefined; });
        window.addEventListener("message", async e => {
            if (e.source !== window || e.origin !== location.origin) return;
            const d = e.data as { source?: string; type?: string; code?: unknown };
            if (d?.source !== APP_SOURCE) return;
            if (["profile-start", "profile-cancel", "profile-result"].includes(d.type ?? "")) {
                try { connect().postMessage(d); }
                catch { port = undefined; reply({ type: "profile-error", error: "Reload this page after updating the extension, then retry." }); }
                return;
            }
            if (d.type === "ping") await hello();
            if (d.type === "pair" && typeof d.code === "string") {
                const res = (await chrome.runtime.sendMessage({ type: "pair", code: d.code }).catch(() => null)) as { ok: boolean; error?: string } | null;
                reply({ type: "paired", ok: Boolean(res?.ok), error: res?.ok ? undefined : res?.error ?? "The extension did not answer." });
            }
        });
        void hello();
    },
});
