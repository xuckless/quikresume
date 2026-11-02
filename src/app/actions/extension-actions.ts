// src/app/actions/extension-actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { requireUid } from "@/lib/db/session";
import { createLinkCode, revokeDevice } from "@/lib/ext/tokens";
import { RATE, rateLimit, rateLimitMessage } from "@/lib/security/rate-limit";

/** A one-time code the extension redeems at POST /api/ext/pair (10 min, single use). */
export async function createExtensionCode(): Promise<{ ok: true; code: string; expiresAt: string } | { ok: false; error: string }> {
    const uid = await requireUid();
    const limit = await rateLimit(RATE.extCode, uid);
    if (!limit.ok) return { ok: false, error: rateLimitMessage(limit, "connection codes") };
    return { ok: true, ...(await createLinkCode(uid)) };
}

export async function revokeExtensionDevice(id: string): Promise<void> {
    const uid = await requireUid();
    if (!(await revokeDevice(uid, id))) throw new Error("That browser is already disconnected.");
    revalidatePath("/dashboard/extension");
}
