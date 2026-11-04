// src/lib/ext/match-summary.ts
// Server-only: what the extension side panel shows for a job, scored on the résumé the extension
// would send: the job's linked variant (job.variantId) when it still exists, otherwise the working
// selection. Same pure scorer as the web page (lib/match/score.ts).

import "server-only";
import { asUser } from "@/lib/db/session";
import { loadResumeData } from "@/lib/db/load-resume";
import { readVariant } from "@/lib/db/variants";
import { readTagAliases } from "@/lib/db/meta";
import { applyVariant } from "@/lib/variants";
import { scoreJob, scoreOptionsFor } from "@/lib/match/score";
import { readMatch } from "@/lib/db/jobs";
import type { JobRecord } from "@/lib/match/types";
import type { ResumeData } from "@/types/schema";

export interface ResumeSource { kind: "variant" | "selection"; variantId: string | null; name: string }

export async function resumeForJob(uid: string, variantId: string | null): Promise<{ resume: ResumeData; source: ResumeSource; library: ResumeData }> {
    const library = await asUser(uid, () => loadResumeData(uid));
    const variant = variantId ? await readVariant(uid, variantId) : null;
    if (variant) {
        const resume = applyVariant(library, variant.items, variant.hidden);
        if (variant.layout) resume.layout = variant.layout;
        return { resume, library, source: { kind: "variant", variantId: variant.id, name: variant.name } };
    }
    return { resume: library, library, source: { kind: "selection", variantId: null, name: "Working selection" } };
}

export async function jobSummary(uid: string, job: JobRecord) {
    const [{ resume, source }, aliases] = await Promise.all([resumeForJob(uid, job.variantId), readTagAliases(uid)]);
    const m = scoreJob(job.requirements, resume, aliases, scoreOptionsFor(job));
    return {
        job: {
            id: job.id, title: job.title, company: job.company, status: job.status, url: job.url, location: job.location,
            appliedAt: job.appliedAt, variantId: job.variantId, match: readMatch(job.match),
        },
        resume: source,
        score: m.score,
        band: m.band,
        gated: m.gated,
        must: m.must,
        nice: m.nice,
        subScores: m.subScores,
        missingMust: m.missingMust.map(r => r.display),
        whatIf: m.rows.filter(r => r.gain >= 0.5).sort((a, b) => b.gain - a.gain).slice(0, 5)
            .map(r => ({ display: r.requirement.display, importance: r.requirement.importance, gain: r.gain })),
    };
}
