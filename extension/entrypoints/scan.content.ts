// The same detector, injected on demand (side panel "Scan this page", activeTab) on any other site.
import { runDetector } from "../lib/detector";

export default defineContentScript({
    registration: "runtime",
    main() {
        runDetector();
    },
});
