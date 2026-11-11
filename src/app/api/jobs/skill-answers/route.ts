// src/app/api/jobs/skill-answers/route.ts
// POST { answers: [{ name, display, kind, hard, have, categoryId?, example?, itemId? }] } -> { ok, resume, declined, warning? }.
// The tailor window's questionnaire, for job requirements nothing in the library covers.
// "Yes" on a soft requirement appends it to the printed "Soft skills" category; "Yes" on a hard
// requirement appends it to the skill category the user picked, or the one the text model
// picks (a new "Technical skills" category when nothing fits); either way the category is switched on
// with the answered skills shown, so they count for the working selection. An example becomes one
// AI-worded bullet on the item the user picked. Touched items are re-tagged and additionally
// carry the answered requirement's tag, so coverage is immediate even if tagging fails.
// "No" is remembered in meta/preferences.declinedSoftSkills (hard and soft; warned about on
// later jobs until answered Yes).
//
// Guarded (lib/security/guard.ts): same-origin, session, per-user rate limit. The model calls are
// optional (answers are saved as written when they fail), so the AI budget is checked inside
// chatCompletion.

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { Timestamp } from "firebase-admin/firestore";
import { chatCompletion, isGlmConfigured, textModel } from "@/lib/glm/client";
import { extractJson } from "@/lib/import/parsed-resume";
import { mergeTagAliases, readTagAliases } from "@/lib/db/meta";
import { readPreferences, writePreferences } from "@/lib/db/jobs";
import { userCol } from "@/lib/db/user-collection";
import { db } from "@/lib/firestore";
import { loadResumeData } from "@/lib/db/load-resume";
import { readCandidateContext } from "@/lib/db/characterization";
import { SKILL_BULLET_SYSTEM_PROMPT, SKILL_CATEGORY_SYSTEM_PROMPT, skillBulletUserMessage, skillCategoryUserMessage } from "@/lib/match/prompt";
import type { DeclinedSkill } from "@/lib/match/types";
import { contentHashOf, itemText, tagContext, type TagInput } from "@/lib/tags/content";
import { extractTags } from "@/lib/tags/extract";
import { isTagKind, type Tag, type TagKind } from "@/lib/tags/types";
import { SECTION_COLLECTION, itemTitle } from "@/lib/sections";
import { skillEntries } from "@/lib/sub-items";
import { withAnsweredSkills } from "@/lib/match/answered-skills";
import { toBullets } from "@/lib/typst/doc";
import type { ResumeData, ResumeListKey } from "@/types/schema";
import { guardApi } from "@/lib/security/guard";
import { RATE } from "@/lib/security/rate-limit";
import { withAiUser } from "@/lib/security/ai-budget";
import { readJsonBody } from "@/lib/security/request";
import { cleanModelText, stripHiddenChars } from "@/lib/security/prompt";
import { isDocId } from "@/lib/validation/limits";

export const runtime = "nodejs";
export const maxDuration = 120;

const SOFT_CATEGORY = "Soft skills";
const HARD_CATEGORY = "Technical skills";
const BULLET_SECTIONS: ResumeListKey[] = ["workExperience", "projects", "volunteering"];

interface Answer {
    name: string;
    display: string;
    kind: TagKind;
    /** Hard requirement (goes into a technical category, not "Soft skills"). */
    hard: boolean;
    have: boolean;
    /** Skill category id picked by the user; "" lets the text model pick. */
    categoryId: string;
    example: string;
    itemId: string;
}

const fail = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });

const clean = (v: unknown, max: number) => (typeof v === "string" ? stripHiddenChars(v).trim().slice(0, max) : "");

function readAnswers(v: unknown): Answer[] {
    if (!Array.isArray(v)) return [];
    const out: Answer[] = [];
    for (const r of v.slice(0, 60)) {
        if (!r || typeof r !== "object") continue;
        const o = r as Record<string, unknown>;
        const name = clean(o.name, 120);
        if (!name || typeof o.have !== "boolean") continue;
        out.push({
            name,
            display: clean(o.display, 120) || name,
            kind: isTagKind(o.kind) ? o.kind : "soft-skill",
            hard: o.hard === true,
            have: o.have,
            categoryId: isDocId(o.categoryId) ? o.categoryId : "",
            example: clean(o.example, 600),
            itemId: isDocId(o.itemId) ? o.itemId : "",
        });
    }
    return out;
}

const unionTags = (a: Tag[], b: Tag[]) => {
    const seen = new Set(a.map(t => t.name));
    return [...a, ...b.filter(t => !seen.has(t.name) && seen.add(t.name))];
};

export async function POST(req: Request) {
    const g = await guardApi(req, RATE.skillAnswers, { what: "questionnaire saves" });
    if (!g.ok) return g.response;
    const uid = g.uid;

    const parsed = await readJsonBody<{ answers?: unknown }>(req, 256 * 1024);
    if (!parsed.ok) return parsed.response;
    const answers = readAnswers(parsed.body.answers);
    if (answers.length === 0) return fail(400, "No answers to save.");

    return withAiUser(uid, "skill-answers", async () => {
        try {
            const [data, prefs, aliases, candidate] = await Promise.all([loadResumeData(uid), readPreferences(uid), readTagAliases(uid), readCandidateContext(uid)]);
            const yes = answers.filter(a => a.have);
            const no = answers.filter(a => !a.have);
            const warnings: string[] = [];
            const now = Timestamp.now();

            // In-memory copies of the items we touch: key -> item (post-change), plus the tags to force on.
            const touched = new Map<string, { key: ResumeListKey; item: ResumeData[ResumeListKey][number]; forced: Tag[]; isNew: boolean }>();
            const reqTag = (a: Answer): Tag => ({ name: a.name, display: a.display, kind: a.kind });

            type Skill = ResumeData["skills"][number];
            const categoryNamed = (name: string): Skill | undefined => {
                const lower = name.trim().toLowerCase();
                const pending = [...touched.values()].find(t => t.key === "skills" && (t.item as Skill).category.trim().toLowerCase() === lower);
                return (pending?.item as Skill | undefined) ?? data.skills.find(s => s.category.trim().toLowerCase() === lower);
            };
            /** Appends the answered skills to a category (an existing item, or a new one by name). */
            const addSkills = (target: Skill | string, group: Answer[]) => {
                const found = typeof target === "string" ? categoryNamed(target) : target;
                const current = found ? ((touched.get(found.id)?.item as Skill | undefined) ?? found) : undefined;
                // Appended, and the category switched on with those skills shown (lib/match/answered-skills.ts).
                const item = withAnsweredSkills(
                    current ?? { id: userCol(uid, "skills").doc().id, category: target as string, items: "", isSelected: true, hidden: [], tags: [], tagsHash: null },
                    group.map(a => a.display),
                );
                const prev = touched.get(item.id);
                touched.set(item.id, { key: "skills", item, forced: unionTags(prev?.forced ?? [], group.map(reqTag)), isNew: prev?.isNew ?? !current });
            };

            // 1. Soft requirements -> "Soft skills" category.
            const softYes = yes.filter(a => !a.hard);
            if (softYes.length > 0) addSkills(SOFT_CATEGORY, softYes);

            // 2. Hard requirements -> the picked category, else the model's pick, else "Technical skills".
            const hardYes = yes.filter(a => a.hard);
            const categoryById = new Map(data.skills.map(s => [s.id, s]));
            const unplaced = hardYes.filter(a => !categoryById.has(a.categoryId));
            const placed = new Map<string, string>();
            const candidates = data.skills.filter(s => s.category.trim().toLowerCase() !== SOFT_CATEGORY.toLowerCase());

            // 3. Examples -> one bullet each on the picked item (worded while the categories are picked).
            const withExample = yes.filter(a => a.example && a.itemId);
            const itemIndex = new Map<string, { key: ResumeListKey; item: ResumeData[ResumeListKey][number] }>();
            for (const key of BULLET_SECTIONS) for (const item of data[key]) itemIndex.set(item.id, { key, item });
            const bulletFor = new Map<number, string>();
            const examples = withExample.map((a, i) => ({ i, a, target: itemIndex.get(a.itemId) })).filter(x => x.target);

            const pickCategories = async () => {
                if (unplaced.length === 0 || candidates.length === 0) return;
                try {
                    if (!isGlmConfigured()) throw new Error("GLM not configured");
                    const result = await chatCompletion(
                        [
                            { role: "system", content: SKILL_CATEGORY_SYSTEM_PROMPT },
                            { role: "user", content: skillCategoryUserMessage({ categories: candidates.map(s => ({ id: s.id, name: s.category, skills: skillEntries(s.items).map(e => e.label) })), skills: unplaced.map(a => a.display) }) },
                        ],
                        { model: textModel(), json: true, effort: "low", temperature: 0.1, maxTokens: 2000, timeoutMs: 30_000, retries: 0 },
                    );
                    const json = extractJson(result.text) as { placements?: unknown };
                    for (const p of Array.isArray(json.placements) ? json.placements : []) {
                        const o = p as Record<string, unknown>;
                        if (typeof o?.skill === "string" && typeof o.categoryId === "string" && candidates.some(s => s.id === o.categoryId)) placed.set(o.skill.trim().toLowerCase(), o.categoryId);
                    }
                } catch (err) {
                    console.error("[jobs/skill-answers] category pick failed:", err);
                    warnings.push(`The AI could not pick a category, so new skills went into "${HARD_CATEGORY}".`);
                }
            };
            const wordBullets = async () => {
                if (examples.length === 0) return;
                try {
                    if (!isGlmConfigured()) throw new Error("GLM not configured");
                    const result = await chatCompletion(
                        [
                            { role: "system", content: SKILL_BULLET_SYSTEM_PROMPT },
                            { role: "user", content: skillBulletUserMessage(examples.map(x => ({ key: String(x.i), skill: x.a.display, item: itemTitle(x.target!.key, x.target!.item), example: x.a.example })), candidate) },
                        ],
                        { model: textModel(), json: true, effort: "low", temperature: 0.3, maxTokens: 3000, timeoutMs: 40_000, retries: 0 },
                    );
                    const json = extractJson(result.text) as { bullets?: unknown };
                    for (const b of Array.isArray(json.bullets) ? json.bullets : []) {
                        const o = b as Record<string, unknown>;
                        const bullet = typeof o?.bullet === "string" ? cleanModelText(o.bullet, 300) : "";
                        if (typeof o?.key === "string" && bullet) bulletFor.set(Number(o.key), bullet);
                    }
                } catch (err) {
                    console.error("[jobs/skill-answers] bullet wording failed:", err);
                    warnings.push("The AI could not word your examples, so they were added as you wrote them.");
                }
            };
            await Promise.all([pickCategories(), wordBullets()]);

            const byCategory = new Map<string, Answer[]>();
            for (const a of hardYes) {
                const id = categoryById.has(a.categoryId) ? a.categoryId : placed.get(a.display.trim().toLowerCase()) ?? "";
                byCategory.set(id, [...(byCategory.get(id) ?? []), a]);
            }
            for (const [id, group] of byCategory) addSkills(categoryById.get(id) ?? HARD_CATEGORY, group);

            for (const x of examples) {
                const { key, item } = x.target!;
                const current = touched.get(item.id)?.item ?? item;
                const bullet = bulletFor.get(x.i) ?? x.a.example;
                const description = [...toBullets((current as ResumeData["workExperience"][number]).description), bullet].join("\n");
                const prev = touched.get(item.id);
                touched.set(item.id, { key, item: { ...current, description } as typeof item, forced: unionTags(prev?.forced ?? [], [reqTag(x.a)]), isNew: false });
            }

            // 4. Re-tag touched items (bounded), then force the answered requirement tags on.
            let tagsById: Record<string, Tag[]> = {};
            if (touched.size > 0 && isGlmConfigured()) {
                const inputs: TagInput[] = [...touched.values()].map(t => ({ id: t.item.id, section: t.key, text: itemText(t.key, t.item) }));
                try {
                    const res = await extractTags(inputs, aliases, { budgetMs: 30_000, context: tagContext(data) });
                    tagsById = res.tagsById;
                    await mergeTagAliases(uid, res.aliases);
                } catch (err) {
                    console.error("[jobs/skill-answers] tagging failed:", err);
                    warnings.push("Skill analysis did not finish; the answered skills still count for matching.");
                }
            }

            const batch = db.batch();
            for (const t of touched.values()) {
                const hash = contentHashOf(t.key, t.item);
                const tags = unionTags(tagsById[t.item.id] ?? t.item.tags, t.forced);
                const ref = userCol(uid, SECTION_COLLECTION[t.key]).doc(t.item.id);
                const skill = t.key === "skills" ? (t.item as Skill) : null;
                const content = skill
                    ? { category: skill.category, items: skill.items, isSelected: skill.isSelected, hidden: skill.hidden }
                    : { description: toBullets((t.item as ResumeData["workExperience"][number]).description) };
                const fields = { ...content, tags, contentHash: hash, tagsHash: hash, taggedAt: now, updatedAt: now };
                if (t.isNew) batch.set(ref, { isSelected: true, hidden: [], ...fields, createdAt: now });
                else batch.update(ref, fields);
            }

            // 5. Declined list: drop answered-Yes, upsert answered-No.
            const yesNames = new Set(yes.map(a => a.name));
            const declined: DeclinedSkill[] = prefs.declinedSoftSkills.filter(d => !yesNames.has(d.name));
            for (const a of no) if (!declined.some(d => d.name === a.name)) declined.push({ name: a.name, display: a.display, at: now.toDate().toISOString() });

            await batch.commit();
            await writePreferences(uid, { declinedSoftSkills: declined });
            revalidatePath("/dashboard");

            return NextResponse.json({ ok: true, resume: await loadResumeData(uid), declined, warning: warnings.join(" ") || undefined });
        } catch (err) {
            console.error("[jobs/skill-answers] failed:", err);
            return fail(500, "Could not save your answers.");
        }
    });
}
