"use server"

import { db } from "@/lib/firestore"
import { signOut } from "@/auth"
import { deleteAllExtensionAccess } from "@/lib/ext/tokens";
import { RATE } from "@/lib/security/rate-limit";
import { revalidatePath } from "next/cache"
import { Timestamp } from "firebase-admin/firestore";
import type { UserProfile } from "@/types/db"
import type { PersonalInfo } from "@/types/schema";
import { personalInfoToUserDoc } from "@/lib/resume-mapper";
import { readTags } from "@/lib/tags/types";
import { contactBlocking, normalizeContact } from "@/lib/contact/normalize";
import { readLinkChecks } from "@/lib/contact/types";
import { readReview } from "@/lib/review/types";
import { currentUid, requireUid } from "@/lib/db/session";
import { readUserDoc } from "@/lib/db/user-collection";
import { clampPersonalInfo, clampStr, LIMITS } from "@/lib/validation/limits";
import { normalizeLinks, readLinks, type ProfileLink } from "@/lib/contact/links";

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

export async function getUserProfile(): Promise<UserProfile | null> {
    const uid = await currentUid();
    if (!uid) return null

    const userDoc = await readUserDoc(uid);
    const data = userDoc.data();
    if (!userDoc.exists || !data) return null;

    // Pick fields explicitly: the user doc also holds NextAuth adapter fields
    // and Timestamps that must not cross the server -> client boundary.
    return {
        id: userDoc.id,
        firstName: str(data.firstName),
        lastName: str(data.lastName),
        headline: str(data.headline),
        email: str(data.email),
        professionalEmail: str(data.professionalEmail),
        phoneNumber: str(data.phoneNumber),
        location: str(data.location),
        github: str(data.github),
        linkedIn: str(data.linkedIn),
        website: str(data.website),
        bio: str(data.bio),
        profileTags: readTags(data.profileTags),
        links: readLinks(data.links),
        profileTagsHash: str(data.profileTagsHash),
        linkChecks: readLinkChecks(data.linkChecks),
        profileReview: readReview(data.profileReview),
    };
}

export type ProfileSaveResult =
    | { success: true; info: PersonalInfo; links?: ProfileLink[] }
    | { success: false; error: string; field: "email" };

/**
 * Profile page save. Writes the same fields as saveResumeData's personal-info block, normalised
 * (phone format, full link URLs). A malformed email is refused and nothing is written.
 */
/** `links` omitted = leave the stored extra links alone. */
export async function updateUserProfile(input: PersonalInfo, linksInput?: ProfileLink[]): Promise<ProfileSaveResult> {
    const uid = await requireUid();

    const capped = clampPersonalInfo(input);
    const blocking = contactBlocking(capped);
    if (blocking) return { success: false, error: blocking.message, field: "email" };
    const { info } = normalizeContact(capped);
    const links = linksInput === undefined ? undefined : normalizeLinks(readLinks(linksInput)).links;

    try {
        await db.collection("users").doc(uid).set({
            ...personalInfoToUserDoc(info),
            ...(links ? { links } : {}),
            updatedAt: Timestamp.now(),
        }, { merge: true });
    } catch (error: unknown) {
        console.error("Error in updateUserProfile:", error);
        throw new Error(error instanceof Error ? error.message : "Failed to save your profile");
    }

    revalidatePath("/dashboard")
    revalidatePath("/dashboard/profile")
    return { success: true, info, links };
}

/** Accepting a coach suggestion on the headline or summary (Profile page, Library). */
export async function updateProfileFields(patch: { headline?: string; summary?: string }): Promise<void> {
    const uid = await requireUid();
    const doc: Record<string, unknown> = { updatedAt: Timestamp.now() };
    if (typeof patch.headline === "string") doc.headline = clampStr(patch.headline, LIMITS.field) || null;
    if (typeof patch.summary === "string") doc.bio = clampStr(patch.summary, LIMITS.description) || null;
    if (Object.keys(doc).length === 1) return;
    await db.collection("users").doc(uid).update(doc);
    revalidatePath("/dashboard")
    revalidatePath("/dashboard/profile")
}

/**
 * Permanently deletes the account: users/{uid} with every subcollection (library, jobs, variants, vectors,
 * meta), the NextAuth Google account link, extension tokens and codes, and rate-limit counters. Daily AI
 * usage counters (ai_usage) are not linked to anything else and expire through their TTL. `confirmation`
 * must be "DELETE" (typed by the user). Signs out and returns to the landing page.
 */
export async function deleteAccount(confirmation: string): Promise<{ ok: false; error: string }> {
    const uid = await requireUid();
    if (confirmation !== "DELETE") return { ok: false, error: 'Type DELETE to confirm.' };

    await deleteAllExtensionAccess(uid);
    const accounts = await db.collection("accounts").where("userId", "==", uid).get();
    const batch = db.batch();
    for (const d of accounts.docs) batch.delete(d.ref);
    for (const policy of Object.values(RATE)) batch.delete(db.collection("rate_limits").doc(`${policy.name}__${uid}`));
    await batch.commit();
    await db.recursiveDelete(db.collection("users").doc(uid));

    await signOut({ redirectTo: "/?deleted=1" });
    return { ok: false, error: "Signed out." };
}

/** Persist only the explicitly supplied profile URL; never flush editor fields. */
export async function saveLinkedInUrl(raw: string): Promise<string> {
    const uid = await requireUid();
    const { canonicalProfileUrl } = await import("@/lib/import/linkedin");
    const { normalizeLinkedIn } = await import("@/lib/contact/normalize");
    const url = canonicalProfileUrl(normalizeLinkedIn(raw).value);
    if (!url) throw new Error("Enter a LinkedIn profile URL: linkedin.com/in/your-name.");
    await db.collection("users").doc(uid).set({ linkedIn: url, updatedAt: Timestamp.now() }, { merge: true });
    revalidatePath("/dashboard");
    return url;
}
