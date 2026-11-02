// GET /api/ext/resume/pdf?jobId= -> application/pdf of the résumé the job uses (linked variant, else
// the working selection), compiled server-side (lib/typst/server-pdf.ts) for the application form's
// file input.

import { readJob } from "@/lib/db/jobs";
import { resumeForJob } from "@/lib/ext/match-summary";
import { compileResumePdf } from "@/lib/typst/server-pdf";
import { extensionOriginAllowed, extFail, extPreflight, guardExtension } from "@/lib/security/ext-guard";
import { RATE } from "@/lib/security/rate-limit";
import { isDocId } from "@/lib/validation/limits";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const OPTIONS = extPreflight;

export async function GET(req: Request) {
    const g = await guardExtension(req, RATE.extRead);
    if (!g.ok) return g.response;
    const jobId = new URL(req.url).searchParams.get("jobId");
    const job = jobId && isDocId(jobId) ? await readJob(g.uid, jobId) : null;
    try {
        const { resume } = await resumeForJob(g.uid, job?.variantId ?? null);
        const { bytes, fileName } = compileResumePdf(resume);
        const origin = req.headers.get("origin");
        return new NextResponse(Buffer.from(bytes), {
            headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `attachment; filename="${fileName.replace(/[^\w.() -]/g, "_")}"`,
                "Cache-Control": "private, no-store",
                ...(origin && extensionOriginAllowed(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
            },
        });
    } catch (err) {
        console.error("[ext/resume/pdf]", err);
        return extFail(req, 500, "The résumé PDF could not be made.");
    }
}
