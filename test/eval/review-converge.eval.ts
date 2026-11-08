// test/eval/review-converge.eval.ts: does the coach converge? Calls GLM for real (run with
// `node --env-file=.env.local node_modules/vitest/vitest.mjs run --config vitest.eval.config.ts review-converge`).
// Reviews one experience item, accepts every surviving suggestion, and re-reviews with the history the run
// route would send, up to 4 rounds. Converged = a round with no suggestions.

import { it } from "vitest";
import { reviewItems } from "@/lib/review/run";
import { mergeHistory, resolveOutcomes, type ReviewHistoryEntry } from "@/lib/review/history";
import type { ReviewInput } from "@/lib/review/content";
import { bulletKey } from "@/lib/sub-items";

it("coach converges on an experience item", async () => {
    let bullets = [
        "Worked on the payments ledger service written in Go",
        "Helped migrate the monolith to microservices on Kubernetes",
        "Was responsible for on-call and incident response for checkout APIs",
        "Reduced p99 latency of the authorization API from 420ms to 180ms by adding Redis caching",
    ];
    let company = "Lumen Payments";
    let history: ReviewHistoryEntry[] = [];
    for (let round = 1; round <= 4; round++) {
        const input: ReviewInput = {
            id: "w1", target: "workExperience", label: "Senior Software Engineer", meta: "Mar 2022 – Present",
            fields: { title: "Senior Software Engineer", company, description: bullets }, history,
        };
        const { byId } = await reviewItems([input], null);
        const r = byId.w1;
        console.log(`\n--- round ${round}: score ${r?.score} flags ${r?.flags.join(",")}\n${r?.comment}`);
        for (const s of r?.suggestions ?? []) console.log(`  [${s.field}] ${s.current}\n     -> ${s.proposed}`);
        if (!r || r.suggestions.length === 0) { console.log(`CONVERGED after ${round} round(s)`); return; }
        for (const s of r.suggestions) {
            if (s.field === "description") bullets = bullets.map(b => (bulletKey(b) === bulletKey(s.current) ? s.proposed : b));
            if (s.field === "company") company = s.proposed;
        }
        const next: ReviewInput = { ...input, fields: { title: "Senior Software Engineer", company, description: bullets } };
        history = mergeHistory(history, resolveOutcomes(next, r.suggestions));
    }
    console.log("DID NOT CONVERGE in 4 rounds");
});
