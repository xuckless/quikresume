"use server"

import { revalidatePath } from "next/cache"
import { Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firestore";
import { readUserDoc, userCol, userDoc } from "@/lib/db/user-collection";
import { currentUid, requireUid } from "@/lib/db/session";
import { applyVariantSelection, listItemIds, readVariant, readVariants, readWorkingLayout, snapshotSelection } from "@/lib/db/variants";
import { replaceMeta } from "@/lib/db/meta";
import { normalizeLayout } from "@/lib/layout/presets";
import type { ResumeLayout } from "@/lib/layout/types";
import { COLLECTION_NAMES } from "@/lib/sections";
import { readVariantHidden, readVariantItems, type VariantHidden, type VariantItems } from "@/lib/variants";
import { clampStr } from "@/lib/validation/limits";
import type { ResumeVariant } from "@/types/db";

const MAX_NAME = 80;
const MAX_LABELS = 12;
const MAX_VARIANTS = 200;

const cleanName = (s: unknown) => clampStr(s, MAX_NAME);
const cleanLabels = (labels: unknown) =>
    [...new Set((Array.isArray(labels) ? labels : []).map(l => clampStr(l, 40)).filter(Boolean))].slice(0, MAX_LABELS);

const revalidate = () => {
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/variants");
};

/** Variants are pointers, but a runaway client could still fill the collection. */
async function assertVariantRoom(uid: string) {
    const snap = await userCol(uid, "variants").select().limit(MAX_VARIANTS).get();
    if (snap.size >= MAX_VARIANTS) throw new Error(`You can keep at most ${MAX_VARIANTS} variants. Delete some first.`);
}

export async function getVariants(): Promise<ResumeVariant[]> {
    const uid = await currentUid();
    if (!uid) return [];
    return readVariants(uid);
}

export async function getLoadedVariantId(): Promise<string | null> {
    const uid = await currentUid();
    if (!uid) return null;
    const doc = await readUserDoc(uid);
    const v = doc.data()?.loadedVariantId;
    return typeof v === "string" && v ? v : null;
}

/** Snapshots the current working selection as a new variant. */
export async function createVariant(input: { name: string; labels?: string[] }): Promise<{ id: string }> {
    const uid = await requireUid();
    await assertVariantRoom(uid);
    const name = cleanName(input.name) || "Untitled resume";
    const [{ items, hidden }, layout] = await Promise.all([snapshotSelection(uid), readWorkingLayout(uid)]);
    const now = Timestamp.now();
    const ref = await userCol(uid, "variants").add({
        name, labels: cleanLabels(input.labels), items, hidden, layout, templateId: layout.theme.templateId, createdAt: now, updatedAt: now,
    });
    await db.collection("users").doc(uid).set({ loadedVariantId: ref.id, updatedAt: now }, { merge: true });
    revalidate();
    return { id: ref.id };
}

export async function updateVariant(id: string, patch: { name?: string; labels?: string[] }) {
    const uid = await requireUid();
    const data: Record<string, unknown> = { updatedAt: Timestamp.now() };
    if (patch.name !== undefined) data.name = cleanName(patch.name) || "Untitled resume";
    if (patch.labels !== undefined) data.labels = cleanLabels(patch.labels);
    await userDoc(uid, "variants", id).update(data);
    revalidate();
}

/** Replaces the variant's pointers (and hidden sub-items) with the current working selection. */
export async function resnapshotVariant(id: string) {
    const uid = await requireUid();
    const [{ items, hidden }, layout] = await Promise.all([snapshotSelection(uid), readWorkingLayout(uid)]);
    const now = Timestamp.now();
    await userDoc(uid, "variants", id).update({ items, hidden, layout, updatedAt: now });
    await db.collection("users").doc(uid).set({ loadedVariantId: id, updatedAt: now }, { merge: true });
    revalidate();
}

export async function duplicateVariant(id: string): Promise<{ id: string }> {
    const uid = await requireUid();
    await assertVariantRoom(uid);
    const src = await readVariant(uid, id);
    if (!src) throw new Error("Variant not found");
    const now = Timestamp.now();
    const ref = await userCol(uid, "variants").add({
        name: cleanName(`${src.name} (copy)`), labels: src.labels, items: src.items, hidden: src.hidden, layout: src.layout, templateId: src.templateId, createdAt: now, updatedAt: now,
    });
    revalidate();
    return { id: ref.id };
}

export async function deleteVariant(id: string) {
    const uid = await requireUid();
    await userDoc(uid, "variants", id).delete();
    const userRef = db.collection("users").doc(uid);
    const doc = await userRef.get();
    if (doc.data()?.loadedVariantId === id) await userRef.set({ loadedVariantId: null }, { merge: true });
    revalidate();
}

/** Makes the working selection equal to the variant. Returns how many pointers no longer exist. */
export async function loadVariant(id: string): Promise<{ missing: number }> {
    const uid = await requireUid();
    const v = await readVariant(uid, id);
    if (!v) throw new Error("Variant not found");
    const { applied, missing } = await applyVariantSelection(uid, v.items, v.hidden);
    // Variants saved before layouts (null) leave the working layout alone.
    if (v.layout) await replaceMeta(uid, "layout", { ...v.layout });
    const now = Timestamp.now();
    if (missing > 0) await userDoc(uid, "variants", id).update({ items: applied, updatedAt: now });
    await db.collection("users").doc(uid).set({ loadedVariantId: id, updatedAt: now }, { merge: true });
    revalidate();
    return { missing };
}

/**
 * Writes a selection built in the browser (the tailor window's Close) onto the working
 * selection without creating a variant. The loaded variant pointer is kept; the
 * toolbar shows it as out of sync when the selection differs.
 */
export async function applyWorkingSelection(input: { items: VariantItems; hidden: VariantHidden; layout?: ResumeLayout }): Promise<{ missing: number }> {
    const uid = await requireUid();
    const items = readVariantItems(input.items as unknown as Record<string, string[]>);
    const { missing } = await applyVariantSelection(uid, items, readVariantHidden(input.hidden) ?? {});
    if (input.layout) await replaceMeta(uid, "layout", { ...normalizeLayout(input.layout) });
    revalidate();
    return { missing };
}

/**
 * Saves a selection built in the browser (tailor window) as a new variant and
 * loads it as the working selection. Ids that no longer exist are dropped.
 */
/** `load: false` (browser extension) saves the variant without making it the working selection. */
export async function createVariantFromPlan(input: { name: string; labels?: string[]; items: VariantItems; hidden: VariantHidden; layout?: ResumeLayout; load?: boolean }): Promise<{ id: string; missing: number }> {
    const uid = await requireUid();
    await assertVariantRoom(uid);
    const existing = await listItemIds(uid);
    const requested = readVariantItems(input.items as unknown as Record<string, string[]>);
    const items = readVariantItems({});
    for (const c of COLLECTION_NAMES) items[c] = requested[c].filter(id => existing[c].includes(id));
    const kept = new Set(COLLECTION_NAMES.flatMap(c => items[c]));
    const hidden = Object.fromEntries(Object.entries(readVariantHidden(input.hidden) ?? {}).filter(([id, keys]) => kept.has(id) && keys.length > 0));

    const layout = input.layout ? normalizeLayout(input.layout) : await readWorkingLayout(uid);

    const now = Timestamp.now();
    const ref = await userCol(uid, "variants").add({
        name: cleanName(input.name) || "Tailored resume", labels: cleanLabels(input.labels), items, hidden, layout, templateId: layout.theme.templateId, createdAt: now, updatedAt: now,
    });
    if (input.load === false) {
        revalidate();
        return { id: ref.id, missing: 0 };
    }
    const { missing } = await applyVariantSelection(uid, items, hidden);
    await replaceMeta(uid, "layout", { ...layout });
    await db.collection("users").doc(uid).set({ loadedVariantId: ref.id, updatedAt: now }, { merge: true });
    revalidate();
    return { id: ref.id, missing };
}
