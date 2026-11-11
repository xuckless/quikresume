import { NextResponse } from "next/server";
import { chatCompletion, GlmError, glmErrorStatus, type GlmContentPart } from "@/lib/glm/client";
import { SYSTEM_PROMPT } from "./prompt";
import { ImportParseError, parseModelOutput } from "./parsed-resume";
import { withAiUser } from "@/lib/security/ai-budget";
import type { ImportResponse } from "./types";
const fail = (status: number, error: string) => NextResponse.json<ImportResponse>({ ok: false, error }, { status });
export async function analyzeResume(uid: string, parts: GlmContentPart[], fileName: string) {
    return withAiUser(uid, "import", async () => {
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
                console.error("[import] could not parse model output:", err.message);
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
