// POST /api/guest/import (multipart: the /api/import upload contract + `turnstile`)
// Signed-out résumé import for /start. Same model and parser as /api/import; nothing is stored: the
// draft lives in the visitor's browser until they sign in (see claimGuestDraft).

import { NextResponse } from "next/server";
import { chatCompletion, GlmError, glmErrorStatus } from "@/lib/glm/client";
import { SYSTEM_PROMPT, userInstruction } from "@/lib/import/prompt";
import { ImportParseError, parseModelOutput } from "@/lib/import/parsed-resume";
import { formToDocument, isDocumentError } from "@/lib/import/document-text";
import { MAX_FILE_BYTES, type ImportResponse } from "@/lib/import/types";
import { GUEST_BUDGET, GUEST_POOL, guardGuest } from "@/lib/security/guest-guard";
import { RATE } from "@/lib/security/rate-limit";
import { withAiUser } from "@/lib/security/ai-budget";
import { fenceUserText } from "@/lib/security/prompt";

export const runtime = "nodejs";
export const maxDuration = 120;

const fail = (status: number, error: string) => NextResponse.json<ImportResponse>({ ok: false, error }, { status });

export async function POST(req: Request) {
    const length = Number(req.headers.get("content-length") ?? 0);
    if (length > MAX_FILE_BYTES * 1.5) return fail(413, "That upload is too large. Keep it under 10 MB.");
    let form: FormData;
    try {
        form = await req.formData();
    } catch {
        return fail(400, "Expected a multipart form upload.");
    }
    const g = await guardGuest(req, RATE.guestImport, String(form.get("turnstile") ?? ""));
    if (!g.ok) return g.response;

    const doc = await formToDocument(form, "resume");
    if (isDocumentError(doc)) return fail(doc.status, doc.error);
    const { fileName, kind } = doc;
    const parts = doc.kind === "text" ? [{ type: "text" as const, text: fenceUserText("RESUME TEXT", doc.text ?? "") }] : doc.parts;
    parts.unshift({ type: "text", text: userInstruction(kind, fileName) });

    return withAiUser(g.guestId, "guest-import", async () => {
        try {
            const result = await chatCompletion([{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: parts }]);
            const parsed = parseModelOutput(result.text);
            return NextResponse.json<ImportResponse>({ ok: true, data: parsed.data, warnings: parsed.warnings, fileName, model: result.model });
        } catch (err) {
            if (err instanceof ImportParseError) return fail(502, "The AI reply could not be understood. Try again, or upload a clearer copy.");
            if (err instanceof GlmError) return fail(glmErrorStatus(err), err.message);
            console.error("[guest/import]", err);
            return fail(500, "Something went wrong while reading the résumé.");
        }
    }, { budget: GUEST_BUDGET, pool: GUEST_POOL });
}
