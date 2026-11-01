// src/lib/db/user-collection.ts
// Shared Firestore helpers for the per-user subcollections. This is a plain
// server-only module (NOT "use server"): the *-actions.ts files stay thin
// async wrappers around these so each action can still check the session.

import "server-only";
import { cache } from "react";
import { Timestamp, type DocumentData, type DocumentSnapshot } from "firebase-admin/firestore";
import { db } from "@/lib/firestore";
import { toUtcDate } from "@/lib/dates";
import { readTags } from "@/lib/tags/types";
import type { TagFields } from "@/types/db";
import { readReview } from "@/lib/review/types";
import { assertDocId, clampStr, LIMITS } from "@/lib/validation/limits";

export type OrderSpec = { field: string; dir: "asc" | "desc" } | null;

export const userCol = (uid: string, name: string) => db.collection("users").doc(uid).collection(name);

/** A document inside one of the user's subcollections; the id must look like one this app wrote. */
export const userDoc = (uid: string, name: string, id: string) => userCol(uid, name).doc(assertDocId(id));

/**
 * The user's own document, read once per request: the dashboard page and several actions all need
 * it, and React's `cache` dedupes the reads inside one server render / action call.
 */
export const readUserDoc = cache((uid: string): Promise<DocumentSnapshot> => db.collection("users").doc(uid).get());

/** "YYYY-MM-DD" -> Timestamp at UTC midnight, or null. */
export const toTimestamp = (s: string | null | undefined): Timestamp | null => {
    const d = toUtcDate(s);
    return d ? Timestamp.fromDate(d) : null;
};

/** Firestore Timestamp -> ISO string; anything else -> null. */
export const isoOf = (v: unknown): string | null =>
    v && typeof (v as Timestamp).toDate === "function" ? (v as Timestamp).toDate().toISOString() : null;

export const strOrNull = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

export const strOf = (v: unknown): string => (typeof v === "string" ? v : "");

export const strArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** Smart-tag and coach-review columns shared by every item row. */
export const tagFieldsOf = (d: DocumentData): TagFields => ({
    tags: readTags(d.tags),
    contentHash: strOrNull(d.contentHash),
    tagsHash: strOrNull(d.tagsHash),
    review: readReview(d.review),
});

/** Checkbox-style booleans arrive as "on" (native) or "true" (hidden input). */
export const formBool = (fd: FormData, key: string): boolean => {
    const v = fd.get(key);
    return v === "on" || v === "true";
};

/** JSON string-array field from FormData (e.g. `hidden`); anything malformed -> []. Bounded. */
export const formStrArray = (fd: FormData, key: string): string[] => {
    try {
        return strArray(JSON.parse(String(fd.get(key) ?? "[]"))).slice(0, LIMITS.hiddenPerItem).map(s => clampStr(s, LIMITS.description));
    } catch {
        return [];
    }
};

/** Required string field from FormData, trimmed and capped (defaults to the short-field cap). */
export const formStr = (fd: FormData, key: string, max: number = LIMITS.short): string => clampStr(fd.get(key), max);

/** Optional string field from FormData: "" -> null. Capped. */
export const formStrOrNull = (fd: FormData, key: string, max: number = LIMITS.short): string | null => clampStr(fd.get(key), max) || null;

/** Newline-separated bullets from FormData -> string[] (blank lines dropped, capped). */
export const formBullets = (fd: FormData, key: string): string[] =>
    clampStr(fd.get(key), LIMITS.description).split("\n").map(l => l.trim()).filter(Boolean);

export async function readCol<T>(
    uid: string,
    name: string,
    order: OrderSpec,
    mapRow: (id: string, data: DocumentData) => T,
): Promise<T[]> {
    const col = userCol(uid, name);
    // NOTE: orderBy(field) silently drops documents missing that field; every
    // writer must always set the ordered field (null is fine, absent is not).
    const snapshot = await (order ? col.orderBy(order.field, order.dir) : col).get();
    return snapshot.docs.map(doc => mapRow(doc.id, doc.data()));
}

export async function updateUserDoc(uid: string, name: string, id: string, patch: Record<string, unknown>) {
    await userDoc(uid, name, id).update({ ...patch, updatedAt: Timestamp.now() });
}

export async function deleteUserDoc(uid: string, name: string, id: string) {
    await userDoc(uid, name, id).delete();
    // The item's cached embeddings (lib/match/evidence.ts) go with it.
    await userCol(uid, "vecs").doc(id).delete().catch(() => {});
}
