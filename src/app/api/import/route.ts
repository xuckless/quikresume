// src/app/api/import/route.ts
// POST multipart/form-data -> GLM-4.6V -> ResumeData draft (temp ids, nothing
// persisted). A Route Handler rather than a server action so uploads are not
// bound by the 1 MB action body limit and the timeout can be set here.
//
// Fields:
//   file      the original upload (image, .docx, .txt/.md). Optional when `pages` is sent.
//   pages     one or more page images (PNG/JPEG) rendered client-side from a PDF.
//   fileName  display name (defaults to file.name).
//
// GLM rejects `file` parts for every model, so PDFs are rasterised in the
// browser (src/lib/import/pdf-pages.ts); DOCX/TXT/images are handled by
// src/lib/import/document-text.ts (shared with /api/jobs/analyze).
//
// Guarded (lib/security/guard.ts): same-origin, session, per-user rate limit, daily AI budget.

import { NextResponse } from "next/server";
import { chatCompletion, GlmError, glmErrorStatus, glmModel, isGlmConfigured } from "@/lib/glm/client";
import { SYSTEM_PROMPT, userInstruction } from "@/lib/import/prompt";
import { ImportParseError, parseModelOutput } from "@/lib/import/parsed-resume";
import { formToDocument, isDocumentError } from "@/lib/import/document-text";
import { MAX_FILE_BYTES, type ImportResponse } from "@/lib/import/types";
import { guardApi } from "@/lib/security/guard";
import { RATE } from "@/lib/security/rate-limit";
import { withAiUser } from "@/lib/security/ai-budget";
import { fenceUserText } from "@/lib/security/prompt";
import { auth } from "@/auth";

export const runtime = "nodejs";
export const maxDuration = 120;

const fail = (status: number, error: string) => NextResponse.json<ImportResponse>({ ok: false, error }, { status });

export async function POST(req: Request) {
    const g = await guardApi(req, RATE.import, { ai: true, feature: "Resume import", what: "imports" });
    if (!g.ok) return g.response;

    const length = Number(req.headers.get("content-length") ?? 0);
    if (length > MAX_FILE_BYTES * 1.5) return fail(413, "That upload is too large. Keep it under 10 MB.");

    let form: FormData;
    try {
        form = await req.formData();
    } catch {
        return fail(400, "Expected a multipart form upload.");
    }

    const doc = await formToDocument(form, "resume");
    if (isDocumentError(doc)) return fail(doc.status, doc.error);
    const { fileName, kind } = doc;
    const parts = doc.kind === "text"
        ? [{ type: "text" as const, text: fenceUserText("RESUME TEXT", doc.text ?? "") }]
        : doc.parts;

    parts.unshift({ type: "text", text: userInstruction(kind, fileName) });

    return withAiUser(g.uid, "import", async () => {
        try {
            const result = await chatCompletion([
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: parts },
            ]);
            const parsed = parseModelOutput(result.text);
            return NextResponse.json<ImportResponse>({
                ok: true, data: parsed.data, warnings: parsed.warnings, fileName, model: result.model,
            });
        } catch (err) {
            if (err instanceof ImportParseError) {
                console.error("[import] could not parse model output:", err.message, "\n---\n", err.raw.slice(0, 500));
                return fail(502, "The AI reply could not be understood. Please try again, or upload a clearer copy of the resume.");
            }
            if (err instanceof GlmError) {
                console.error("[import] GLM error:", err.message);
                return fail(glmErrorStatus(err), err.message);
            }
            console.error("[import] unexpected error:", err);
            return fail(500, "Something went wrong while importing the resume.");
        }
    });
}

export async function GET() {
    const session = await auth();
    if (!session?.user?.id) return fail(401, "You need to be signed in.");
    return NextResponse.json({ model: glmModel(), configured: isGlmConfigured() });
}
