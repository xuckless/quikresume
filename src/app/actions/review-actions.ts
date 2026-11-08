"use server"

import { db } from "@/lib/firestore"
import { revalidatePath } from "next/cache"
import { FieldValue, type DocumentReference } from "firebase-admin/firestore";
import { RESUME_LIST_KEYS } from "@/types/schema";
import { SECTION_COLLECTION } from "@/lib/sections";
import { userDoc } from "@/lib/db/user-collection";
import { requireUid } from "@/lib/db/session";
import { isDocId } from "@/lib/validation/limits";
import { readReview, type ReviewTarget } from "@/lib/review/types";
import { mergeHistory } from "@/lib/review/history";

/** Hides one coach suggestion for good and records it as declined, so the coach doesn't offer it again. */
export async function dismissReviewSuggestion(target: ReviewTarget, id: string, suggestionId: string): Promise<void> {
    const uid = await requireUid();
    // Suggestion ids are stableHash outputs (16 hex chars); anything else is not ours.
    if (typeof suggestionId !== "string" || !/^[a-f0-9]{1,32}$/.test(suggestionId)) return;
    const userRef = db.collection("users").doc(uid);
    let ref: DocumentReference;
    let field: "profileReview" | "review";
    if (target === "profile") { ref = userRef; field = "profileReview"; }
    else if (RESUME_LIST_KEYS.includes(target) && isDocId(id)) { ref = userDoc(uid, SECTION_COLLECTION[target], id); field = "review"; }
    else return;
    try {
        // Remember the declined rewrite itself (not just its id), so later reviews never offer it again.
        await db.runTransaction(async tx => {
            const snap = await tx.get(ref);
            if (!snap.exists) return;
            const review = readReview(snap.get(field));
            const s = review?.suggestions.find(x => x.id === suggestionId);
            const patch: Record<string, unknown> = { [`${field}.dismissed`]: FieldValue.arrayUnion(suggestionId) };
            if (review && s) {
                patch[`${field}.history`] = mergeHistory(review.history, [{ field: s.field, kind: "rejected", current: s.current, proposed: s.proposed }]);
            }
            tx.update(ref, patch);
        });
    } catch (err) {
        // The item was deleted meanwhile: nothing to hide.
        if ((err as { code?: number }).code !== 5) throw err;
    }
    revalidatePath("/dashboard")
    if (target === "profile") revalidatePath("/dashboard/profile")
}
