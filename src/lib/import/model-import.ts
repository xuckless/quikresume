// src/lib/import/model-import.ts
// The model call shared by the résumé import routes (/api/import, /api/guest/import) and the LinkedIn AI
// fallback (/api/ext/profile/analyse): the import system prompt plus the caller's parts -> the reply's
// JSON -> parseImportObject. Callers run it inside withAiUser and map failures with importFailure.

import "server-only";
import { chatCompletion, GlmError, glmErrorStatus, type GlmContentPart, type GlmOptions } from "@/lib/glm/client";
import { SYSTEM_PROMPT } from "@/lib/import/prompt";
import { extractJson, ImportParseError, parseImportObject, type ParsedImport } from "@/lib/import/parsed-resume";

export interface ModelImport {
    /** The model's JSON object as returned (an ImportEnvelope, unvalidated). */
    raw: Record<string, unknown>;
    /** The same, validated into a ResumeData draft. */
    parsed: ParsedImport;
    model: string;
}

/** One import call: the user's message (instruction first) under SYSTEM_PROMPT. Throws GlmError / ImportParseError. */
export async function runImportModel(content: string | GlmContentPart[], opts: GlmOptions = {}): Promise<ModelImport> {
    const result = await chatCompletion([{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content }], opts);
    const raw = extractJson(result.text);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ImportParseError("The model reply was not a JSON object.", result.text);
    return { raw: raw as Record<string, unknown>, parsed: parseImportObject(raw), model: result.model };
}

/**
 * Status and user-facing message for a failed import call; `tag` prefixes the server log. `logReply`
 * adds the start of an unparseable reply to the log (signed-in imports only).
 */
export function importFailure(
    err: unknown, tag: string, messages: { unreadable: string; other: string }, { logReply = false }: { logReply?: boolean } = {},
): { status: number; error: string } {
    if (err instanceof ImportParseError) {
        console.error(`[${tag}] could not parse model output:`, err.message, ...(logReply ? ["\n---\n", err.raw.slice(0, 500)] : []));
        return { status: 502, error: messages.unreadable };
    }
    if (err instanceof GlmError) {
        console.error(`[${tag}] GLM error:`, err.message);
        return { status: glmErrorStatus(err), error: err.message };
    }
    console.error(`[${tag}] unexpected error:`, err);
    return { status: 500, error: messages.other };
}
