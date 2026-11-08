// src/app/api/review/run/route.ts
// POST { ids?: string[], scope?: "stale" | "outdated-brief" } -> { ok, reviewed, skipped, remaining, retagged }.
// Background career-coach review. Default scope reviews items whose text changed since their last review
// (reviewHash !== content hash); `ids` forces a re-review of those items; "outdated-brief" also picks
// reviews written before the current "About you" brief. At most REVIEW_MAX_PER_RUN items per request
// (selected items first); the client asks again while `remaining > 0`.
//
// Items whose smart tags are stale (a coach rewrite accepted in the Library) are re-tagged first, since
// the Library's instant updates don't run the tagger. A per-user lock (meta/review) keeps two tabs from
// reviewing at once. Writes use update(), so an item deleted mid-run is never recreated.
//
// Guarded (lib/security/guard.ts): same-origin, session, per-user rate limit, daily AI budget.

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firestore";
import { loadLibraryWithReviews } from "@/lib/db/load-resume";
import { readCandidateContext } from "@/lib/db/characterization";
import { mergeTagAliases, readTagAliases } from "@/lib/db/meta";
import { stripUndefined } from "@/lib/db/jobs";
import { extractTags } from "@/lib/tags/extract";
import { contentHashOf, hasContent, isStale, itemText, PROFILE_ID, profileHashOf, tagContext, type TagInput } from "@/lib/tags/content";
import { SECTION_COLLECTION } from "@/lib/sections";
import { isBriefOutdated, isProfileReviewStale, isReviewStale, profileReviewInput, reviewInputOf, type ReviewInput } from "@/lib/review/content";
import { MAX_PRIOR, mergeHistory, normText, readCandidates, readHistory, resolveOutcomes, type ReviewHistoryEntry } from "@/lib/review/history";
import type { ItemReview } from "@/lib/review/types";
import { acquireReviewLock, releaseReviewLock, REVIEW_MAX_PER_RUN, reviewItems } from "@/lib/review/run";
import { RESUME_LIST_KEYS, type ResumeData, type ResumeListKey } from "@/types/schema";
import { guardApi } from "@/lib/security/guard";
import { RATE } from "@/lib/security/rate-limit";
import { withAiUser } from "@/lib/security/ai-budget";
import { readJsonBody } from "@/lib/security/request";
import { isDocId } from "@/lib/validation/limits";

export const runtime = "nodejs";
export const maxDuration = 300;

const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ ok: false, error, ...extra }, { status });
const notFound = (r: PromiseSettledResult<unknown>) => r.status === "rejected" && (r.reason as { code?: number })?.code === 5;

type AnyItem = ResumeData[ResumeListKey][number];

export async function POST(req: Request) {
    const g = await guardApi(req, RATE.review, { ai: true, feature: "AI reviews", what: "review runs" });
    if (!g.ok) return g.response;
    const uid = g.uid;

    const parsed = await readJsonBody<{ ids?: unknown; scope?: unknown }>(req, 64 * 1024);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    const forced = new Set(Array.isArray(body.ids) ? body.ids.filter((x): x is string => isDocId(x) || x === PROFILE_ID).slice(0, 50) : []);
    const scope = body.scope === "outdated-brief" ? "outdated-brief" : "stale";

    if (!(await acquireReviewLock(uid))) return fail(409, "A review is already running.", { busy: true });
    return withAiUser(uid, "review", async () => {
        try {
            const [{ data, reviews, profileReview }, candidate] = await Promise.all([loadLibraryWithReviews(uid, g.session.user?.name), readCandidateContext(uid)]);
            const briefHash = candidate?.briefHash ?? null;

            // Pick the work: forced ids, stale reviews, and (on request) reviews from an older brief.
            const picked: { input: ReviewInput; key: ResumeListKey | "profile"; item: AnyItem | null; selected: boolean }[] = [];
            const want = (review: typeof profileReview, stale: boolean, id: string) =>
                forced.size > 0 ? forced.has(id) : stale || (scope === "outdated-brief" && isBriefOutdated(review, briefHash));
            if ((data.personalInfo.headline.trim() || data.personalInfo.summary.trim())
                && want(profileReview, isProfileReviewStale(data.personalInfo, profileReview), PROFILE_ID)) {
                picked.push({ input: profileReviewInput(data.personalInfo), key: "profile", item: null, selected: true });
            }
            for (const key of RESUME_LIST_KEYS) {
                for (const item of data[key] as AnyItem[]) {
                    if (!hasContent(key, item)) continue;
                    if (want(reviews[item.id], isReviewStale(key, item, reviews[item.id]), item.id)) {
                        picked.push({ input: reviewInputOf(key, item), key, item, selected: item.isSelected });
                    }
                }
            }
            picked.sort((a, b) => Number(b.selected) - Number(a.selected));
            const batch = picked.slice(0, REVIEW_MAX_PER_RUN);
            // What the user did with earlier rewrites, so the coach converges instead of rewording forever.
            for (const p of batch) p.input.history = historyFor(p.input, p.key === "profile" ? profileReview : reviews[p.input.id]);
            if (batch.length === 0) return NextResponse.json({ ok: true, reviewed: 0, skipped: 0, remaining: 0, retagged: 0 });

            const userRef = db.collection("users").doc(uid);
            const now = Timestamp.now();

            // Re-tag items in this batch whose tags went stale outside a save (bounded; failures only log).
            let retagged = 0;
            const tagStale: TagInput[] = batch.flatMap(p => (p.item && p.key !== "profile" && isStale(p.key, p.item) ? [{ id: p.item.id, section: p.key, text: itemText(p.key, p.item) }] : []));
            const reviewPromise = reviewItems(batch.map(p => p.input), candidate);
            if (tagStale.length > 0) {
                try {
                    const res = await extractTags(tagStale, await readTagAliases(uid), { budgetMs: 40_000, context: tagContext(data) });
                    const writes = batch.flatMap(p => {
                        const tags = p.item && p.key !== "profile" ? res.tagsById[p.item.id] : undefined;
                        if (!tags || !p.item || p.key === "profile") return [];
                        const h = contentHashOf(p.key, p.item);
                        return [userRef.collection(SECTION_COLLECTION[p.key]).doc(p.item.id).update({ tags, contentHash: h, tagsHash: h, taggedAt: now })];
                    });
                    retagged = (await Promise.allSettled(writes)).filter(r => r.status === "fulfilled").length;
                    await mergeTagAliases(uid, res.aliases);
                } catch (err) {
                    console.error("[review/run] re-tagging failed:", err);
                }
            }

            const { byId, skipped } = await reviewPromise;
            const writes = batch.flatMap(p => {
                const r = byId[p.input.id];
                if (!r) return [];
                // Hash of the text as loaded: an edit made while the model ran shows as outdated and is picked up next time.
                const reviewHash = p.key === "profile" ? profileHashOf(data.personalInfo) : contentHashOf(p.key, p.item as AnyItem);
                const ref = p.key === "profile" ? userRef : userRef.collection(SECTION_COLLECTION[p.key]).doc(p.input.id);
                const fieldName = p.key === "profile" ? "profileReview" : "review";
                // A transaction, so a dismissal (or an accept) made while the model ran is kept, not overwritten.
                return [db.runTransaction(async tx => {
                    const snap = await tx.get(ref);
                    if (!snap.exists) return;
                    const raw = (snap.get(fieldName) ?? {}) as Record<string, unknown>;
                    const rawSuggestions = readCandidates(raw.suggestions);
                    const rawPrior = readCandidates(raw.prior);
                    const rawDismissed = Array.isArray(raw.dismissed) ? raw.dismissed.filter((x): x is string => typeof x === "string") : [];
                    const history = mergeHistory(readHistory(raw.history), p.input.history ?? [], resolveOutcomes(p.input, rawSuggestions, rawDismissed));
                    const resolved = new Set(history.map(h => `${h.field}|${normText(h.current)}|${normText(h.proposed)}`));
                    const prior = [...rawSuggestions, ...rawPrior]
                        .filter(c => !resolved.has(`${c.field}|${normText(c.current)}|${normText(c.proposed)}`))
                        .slice(0, MAX_PRIOR)
                        .map(c => ({ field: c.field, current: c.current, proposed: c.proposed, ...(c.id ? { id: c.id } : {}) }));
                    const review = stripUndefined({ ...r, dismissed: rawDismissed.slice(-50), history, prior, reviewHash, briefHash, reviewedAt: now });
                    tx.update(ref, { [fieldName]: review });
                })];
            });
            const settled = await Promise.allSettled(writes);
            const failed = settled.filter(r => r.status === "rejected" && !notFound(r));
            if (failed.length > 0) console.error("[review/run] some writes failed:", (failed[0] as PromiseRejectedResult).reason);

            const reviewed = settled.filter(r => r.status === "fulfilled").length;
            if (reviewed > 0 || retagged > 0) {
                revalidatePath("/dashboard");
                revalidatePath("/dashboard/profile");
            }
            return NextResponse.json({ ok: true, reviewed, skipped: skipped.length, remaining: picked.length - batch.length + skipped.length, retagged });
        } catch (err) {
            console.error("[review/run] failed:", err);
            return fail(500, "The review could not run. Try again later.");
        } finally {
            await releaseReviewLock(uid).catch(() => {});
        }
    });
}

/** Earlier history plus what happened to the last review's rewrites (accepted into the text, or dismissed). */
function historyFor(input: ReviewInput, prev: ItemReview | null | undefined): ReviewHistoryEntry[] {
    if (!prev) return [];
    return mergeHistory(prev.history, resolveOutcomes(input, [...prev.suggestions, ...prev.prior], prev.dismissed));
}
