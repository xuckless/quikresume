// Static content script on known job boards / ATSs (lib/sites.ts).
import { JOB_SITES } from "../lib/sites";
import { runDetector } from "../lib/detector";

export default defineContentScript({
    matches: JOB_SITES,
    runAt: "document_idle",
    main() {
        runDetector();
    },
});
