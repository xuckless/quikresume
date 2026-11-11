// POST /api/ext/profile/analyse {url, text} -> {ok, data: ImportEnvelope, warnings}
// The LinkedIn import's AI fallback: when the extension's parser cannot read the member's own profile
// page (an unrecognised layout, a card it could not parse), it sends the page's visible text (≤
// MAX_PROFILE_TEXT) and the text model structures it with the résumé-import prompt (low effort). Nothing
// is stored: the extension merges the reply into its capture and the page validates it again before review.

import { textModel } from "@/lib/glm/client";
import { importFailure, runImportModel } from "@/lib/import/model-import";
import { canonicalProfileUrl, LINKEDIN_SOURCE, MAX_PROFILE_TEXT } from "@/lib/import/linkedin";
import { readImportEnvelope } from "@/lib/import/parsed-resume";
import { LINKEDIN_TEXT_NOTE, userInstruction } from "@/lib/import/prompt";
import { extFail, extJson, extPreflight, guardExtension } from "@/lib/security/ext-guard";
import { RATE } from "@/lib/security/rate-limit";
import { withAiUser } from "@/lib/security/ai-budget";
import { fenceUserText } from "@/lib/security/prompt";
import { readJsonBody } from "@/lib/security/request";
import { RESUME_LIST_KEYS } from "@/types/schema";

export const runtime = "nodejs";
export const maxDuration = 120;
export const OPTIONS = extPreflight;

export async function POST(req: Request) {
    const g = await guardExtension(req, RATE.extProfile, { ai: true, feature: "LinkedIn import", what: "LinkedIn imports" });
    if (!g.ok) return g.response;
    // UTF-8 and JSON escaping: up to ~4 bytes per character of text.
    const body = await readJsonBody<{ url?: unknown; text?: unknown }>(req, MAX_PROFILE_TEXT * 4 + 4096);
    if (!body.ok) return body.response;
    const url = typeof body.body.url === "string" ? canonicalProfileUrl(body.body.url) : null;
    if (!url) return extFail(req, 400, "That is not a LinkedIn profile URL.");
    const text = typeof body.body.text === "string" ? body.body.text : "";
    if (!text.trim()) return extFail(req, 400, "The profile page had no readable text.");
    if (text.length > MAX_PROFILE_TEXT) return extFail(req, 413, "Your profile is too long to read with AI.");

    return withAiUser(g.uid, "linkedin-import", async () => {
        try {
            const { raw, parsed } = await runImportModel(
                `${userInstruction("text", LINKEDIN_SOURCE)}\n${LINKEDIN_TEXT_NOTE}\n\n${fenceUserText("RESUME TEXT", text, MAX_PROFILE_TEXT)}`,
                { model: textModel(), json: true, effort: "low", temperature: 0.1, maxTokens: 16_000, timeoutMs: 90_000, retries: 0 },
            );
            const { data } = parsed;
            const found = Object.values(data.personalInfo).some(v => v.trim() !== "") || RESUME_LIST_KEYS.some(key => data[key].length > 0);
            if (!found) return extFail(req, 422, "Nothing could be read from your profile.");
            return extJson(req, { ok: true, data: readImportEnvelope(raw), warnings: parsed.warnings });
        } catch (err) {
            const { status, error } = importFailure(err, "ext/profile/analyse", {
                unreadable: "The AI reply could not be understood. Try again.",
                other: "Could not read your profile with AI.",
            });
            return extFail(req, status, error);
        }
    });
}
