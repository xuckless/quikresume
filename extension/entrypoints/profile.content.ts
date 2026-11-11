import { captureProfile, profileAvailability } from '../lib/profile-extract';
export default defineContentScript({
    matches: ['https://www.linkedin.com/in/*', 'https://linkedin.com/in/*'],
    main() {
        chrome.runtime.onMessage.addListener((m, _sender, reply) => {
            if (m?.type === 'profile-availability') { reply(profileAvailability(document)); return; }
            if (m?.type !== 'capture-profile' || typeof m.url !== 'string') return;
            captureProfile(m.url).then(data => reply({ ok: true, ...data }), err => reply({ ok: false, error: String(err.message) }));
            return true;
        });
    },
});
