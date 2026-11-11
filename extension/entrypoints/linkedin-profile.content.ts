// Runs on LinkedIn profile pages (and is injected into tabs that reached a profile by in-app navigation).
// Answers the background only (extension/lib/linkedin-session.ts): whether the page is a login wall, and
// the parsed profile (lib/profile-extract.ts) when the user clicks Import in the side panel. Never reads
// anything on its own; the only page it fetches is the member's own /details/ lists.
import { CaptureError, captureProfile, isLoginWall } from "../lib/profile-extract";
import type { CaptureReply, ProfilePageReply, ProfileTabRequest } from "../lib/linkedin-session";

export default defineContentScript({
    matches: ["https://www.linkedin.com/in/*", "https://linkedin.com/in/*"],
    main() {
        // Injecting again (the background's fallback) must not add a second listener.
        const w = window as unknown as { __quikresumeProfile?: boolean };
        if (w.__quikresumeProfile) return;
        w.__quikresumeProfile = true;

        chrome.runtime.onMessage.addListener((m: ProfileTabRequest, sender, reply) => {
            if (sender.id !== chrome.runtime.id || sender.tab) return;
            if (m?.type === "profile-page") {
                reply({ loginWall: isLoginWall(document) } satisfies ProfilePageReply);
                return;
            }
            if (m?.type !== "capture-profile" || typeof m.url !== "string") return;
            captureProfile(m.url).then(
                capture => reply({ ok: true, ...capture } satisfies CaptureReply),
                err => reply({ ok: false, error: err instanceof CaptureError ? err.message : "Couldn't read your profile. Reload it, then click Import." } satisfies CaptureReply),
            );
            return true;
        });
    },
});
