"use server"

// Entries of user-named sections (collection `custom`, see CustomEntry in types/schema.ts).

import { revalidatePath } from "next/cache"
import type { CustomItem } from "@/types/db";
import { currentUid, requireUid } from "@/lib/db/session";
import {
    tagFieldsOf, deleteUserDoc, formBool, formBullets, formStr, formStrArray, formStrOrNull, strOrNull, isoOf, readCol, strArray, strOf, toTimestamp, updateUserDoc,
} from "@/lib/db/user-collection";

const COL = "custom";

export async function getCustomEntries(): Promise<CustomItem[]> {
    const uid = await currentUid();
    if (!uid) return [];

    return readCol(uid, COL, { field: "createdAt", dir: "asc" }, (id, d) => ({
        id,
        section: strOf(d.section),
        title: strOf(d.title),
        subtitle: strOrNull(d.subtitle),
        startDate: isoOf(d.startDate),
        endDate: isoOf(d.endDate),
        isActive: Boolean(d.isActive),
        description: strArray(d.description),
        hidden: strArray(d.hidden),
        isSelected: Boolean(d.isSelected),
        ...tagFieldsOf(d),
        createdAt: isoOf(d.createdAt),
        updatedAt: isoOf(d.updatedAt),
    }));
}

// Partial update: only fields present in the FormData are written.
export async function updateCustomEntry(entryId: string, formData: FormData) {
    const uid = await requireUid();

    const patch: Record<string, unknown> = {};
    if (formData.has("section")) patch.section = formStr(formData, "section", 60) || "Other";
    if (formData.has("title")) patch.title = formStr(formData, "title");
    if (formData.has("subtitle")) patch.subtitle = formStrOrNull(formData, "subtitle");
    if (formData.has("description")) patch.description = formBullets(formData, "description");
    if (formData.has("startDate")) {
        const ts = toTimestamp(formStr(formData, "startDate", 32));
        if (ts) patch.startDate = ts;
    }
    if (formData.has("endDate")) patch.endDate = toTimestamp(formStr(formData, "endDate", 32));
    if (formData.has("isActive")) patch.isActive = formBool(formData, "isActive");
    if (formData.has("isSelected")) patch.isSelected = formBool(formData, "isSelected");
    if (formData.has("hidden")) patch.hidden = formStrArray(formData, "hidden");

    if (Object.keys(patch).length > 0) await updateUserDoc(uid, COL, entryId, patch);
    revalidatePath("/dashboard")
}

export async function deleteCustomEntry(entryId: string) {
    const uid = await requireUid();
    await deleteUserDoc(uid, COL, entryId);
    revalidatePath("/dashboard")
}
