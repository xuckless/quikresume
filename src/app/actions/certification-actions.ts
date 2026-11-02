"use server"

import { revalidatePath } from "next/cache"
import type { CertificationItem } from "@/types/db";
import { currentUid, requireUid } from "@/lib/db/session";
import {
    tagFieldsOf, deleteUserDoc, formBool, formStr, formStrOrNull, isoOf, readCol, strOf, strOrNull, updateUserDoc,
} from "@/lib/db/user-collection";

const COL = "certifications";

// --- READ ---
export async function getCertifications(): Promise<CertificationItem[]> {
    const uid = await currentUid();
    if (!uid) return [];

    return readCol(uid, COL, { field: "createdAt", dir: "desc" }, (id, d) => ({
        id,
        name: strOf(d.name),
        issuer: strOrNull(d.issuer),
        year: strOf(d.year),
        credentialId: strOrNull(d.credentialId),
        expires: strOrNull(d.expires),
        isSelected: Boolean(d.isSelected),
        ...tagFieldsOf(d),
        createdAt: isoOf(d.createdAt),
        updatedAt: isoOf(d.updatedAt),
    }));
}

// --- UPDATE (partial) ---
export async function updateCertification(certificationId: string, formData: FormData) {
    const uid = await requireUid();

    const patch: Record<string, unknown> = {};
    if (formData.has("name")) patch.name = formStr(formData, "name");
    if (formData.has("issuer")) patch.issuer = formStrOrNull(formData, "issuer");
    if (formData.has("year")) patch.year = formStr(formData, "year", 16);
    if (formData.has("credentialId")) patch.credentialId = formStrOrNull(formData, "credentialId", 60);
    if (formData.has("expires")) patch.expires = formStrOrNull(formData, "expires", 16);
    if (formData.has("isSelected")) patch.isSelected = formBool(formData, "isSelected");

    if (Object.keys(patch).length > 0) await updateUserDoc(uid, COL, certificationId, patch);
    revalidatePath("/dashboard")
}

// --- DELETE ---
export async function deleteCertification(certificationId: string) {
    const uid = await requireUid();
    await deleteUserDoc(uid, COL, certificationId);
    revalidatePath("/dashboard")
}
