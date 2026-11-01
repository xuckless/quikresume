// src/app/actions/autofill-actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { requireUid } from "@/lib/db/session";
import { writeAutofill } from "@/lib/db/autofill";
import { readAutofillPrefs, type AutofillPrefs } from "@/lib/autofill/types";
import { RATE, rateLimit, rateLimitMessage } from "@/lib/security/rate-limit";

export async function saveAutofillPrefs(input: AutofillPrefs): Promise<{ ok: true; prefs: AutofillPrefs } | { ok: false; error: string }> {
    const uid = await requireUid();
    const limit = await rateLimit(RATE.save, uid);
    if (!limit.ok) return { ok: false, error: rateLimitMessage(limit, "saves") };
    const prefs = readAutofillPrefs(input);
    await writeAutofill(uid, prefs);
    revalidatePath("/dashboard/autofill");
    return { ok: true, prefs };
}
