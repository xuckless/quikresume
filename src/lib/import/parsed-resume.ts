// src/lib/import/parsed-resume.ts
// Turns a structured import (envelope.ts) into a ResumeData draft: the model's reply text through
// parseModelOutput, or an object built without a model (a LinkedIn profile captured by the extension)
// through parseImportObject. Tolerant by design: the envelope never fails, each list item is validated
// on its own, and anything unusable is reported in `warnings` instead of failing the import.
// Pure and isomorphic (the LinkedIn path runs in the browser).

import { normalizeLinks, readLinks } from "@/lib/contact/links";
import { z } from "zod";
import type { ResumeData, ResumeListKey } from "@/types/schema";
import { emptyPersonalInfo, emptyResumeData } from "@/types/schema";
import { newTempId } from "@/lib/ids";
import { normalizeContact } from "@/lib/contact/normalize";
import { normalizeDateRange, normalizeImportedDate, normalizeYear } from "@/lib/import/dates";
import { stripHiddenChars } from "@/lib/security/prompt";
import { clampResumeData, LIMITS } from "@/lib/validation/limits";

export class ImportParseError extends Error {
    constructor(message: string, readonly raw: string) {
        super(message);
        this.name = "ImportParseError";
    }
}

// ---------- JSON extraction ----------

/** Finds the first balanced {...} object in free text (fences/thinking stripped). */
export function extractJson(text: string): unknown {
    let t = text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?/gi, "").trim();
    const start = t.indexOf("{");
    if (start < 0) throw new ImportParseError("The model reply contained no JSON object.", text);
    t = t.slice(start);

    let depth = 0, inStr = false, esc = false, end = -1;
    for (let i = 0; i < t.length; i++) {
        const c = t[i];
        if (inStr) {
            if (esc) esc = false;
            else if (c === "\\") esc = true;
            else if (c === "\"") inStr = false;
            continue;
        }
        if (c === "\"") inStr = true;
        else if (c === "{") depth++;
        else if (c === "}") { depth--; if (depth === 0) { end = i; break; } }
    }
    const candidate = end >= 0 ? t.slice(0, end + 1) : t;
    try {
        return JSON.parse(candidate);
    } catch {
        try {
            return JSON.parse(candidate.replace(/,\s*([}\]])/g, "$1"));
        } catch {
            throw new ImportParseError("The model reply was not valid JSON.", text);
        }
    }
}

// ---------- Lenient field schemas ----------

// Strings from the model: hidden characters out, bounded (the whole draft is clamped again at the end).
const str = z.preprocess(v => (v == null ? "" : stripHiddenChars(String(v)).trim().slice(0, LIMITS.long)), z.string());
const strList = z.preprocess(
    v => (Array.isArray(v) ? v.slice(0, 60) : typeof v === "string" ? v.split("\n").slice(0, 60) : []),
    z.array(str),
).transform(list => list.map(x => x.replace(/^[-•*]\s+/, "").trim()).filter(Boolean));

const personal = z.object({
    firstName: str.catch(""), lastName: str.catch(""), headline: str.catch(""), email: str.catch(""),
    phone: str.catch(""), location: str.catch(""), github: str.catch(""), linkedin: str.catch(""),
    website: str.catch(""), summary: str.catch(""),
    /** Some models return a single "name". */
    name: str.catch(""),
}).partial();

const experience = z.object({ title: str, company: str, startDate: z.unknown(), endDate: z.unknown(), bullets: strList.catch([]) });
const education = z.object({ degree: str, institution: str, startDate: z.unknown(), endDate: z.unknown(), gpa: str.catch(""), minor: str.catch(""), details: str.catch("") });
const skill = z.object({ category: str, items: strList.catch([]) });
const project = z.object({ title: str, stack: str.catch(""), link: str.catch(""), startDate: z.unknown(), endDate: z.unknown(), bullets: strList.catch([]) });
const certification = z.object({ name: str, issuer: str.catch(""), year: z.unknown(), credentialId: str.catch(""), expires: z.unknown() });
const award = z.object({ title: str, issuer: str.catch(""), date: z.unknown(), description: str.catch("") });
const volunteering = z.object({ role: str, organization: str, startDate: z.unknown(), endDate: z.unknown(), bullets: strList.catch([]) });
const publication = z.object({ title: str, venue: str.catch(""), date: z.unknown(), link: str.catch(""), authors: str.catch("") });
const language = z.object({ language: str, proficiency: str.catch("") });
const custom = z.object({ section: str.catch(""), title: str, subtitle: str.catch(""), startDate: z.unknown(), endDate: z.unknown(), bullets: strList.catch([]) });

const list = z.array(z.unknown()).transform(l => l.slice(0, LIMITS.itemsPerSection)).catch([]);
const envelope = z.object({
    personalInfo: personal.catch({}),
    workExperience: list, education: list, skills: list, projects: list, certifications: list,
    awards: list, volunteering: list, publications: list, languages: list, custom: list,
    links: z.unknown().catch([]),
});

// ---------- Conversion ----------

export interface ParsedImport {
    data: ResumeData;
    warnings: string[];
}

/** First non-empty string field of an item, for warning messages. */
const firstText = (x: unknown): string => {
    if (!x || typeof x !== "object") return "";
    for (const v of Object.values(x as Record<string, unknown>)) if (typeof v === "string" && v.trim()) return v.trim().slice(0, 40);
    return "";
};

const LABELS: Record<ResumeListKey, string> = {
    workExperience: "work experience", education: "education", skills: "skill category", projects: "project",
    certifications: "certification", awards: "award", volunteering: "volunteering", publications: "publication",
    languages: "language", custom: "entry",
};

export function parseModelOutput(text: string): ParsedImport {
    const raw = extractJson(text);
    if (!raw || typeof raw !== "object") throw new ImportParseError("The model reply was not a JSON object.", text);
    return parseImportObject(raw);
}

/** Validates an already-structured import (ImportEnvelope or anything close to it). Never throws. */
export function parseImportObject(raw: unknown): ParsedImport {
    const env = envelope.parse(raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {});
    const warnings: string[] = [];
    const data = emptyResumeData();

    const p = env.personalInfo;
    const info = { ...emptyPersonalInfo(), ...Object.fromEntries(Object.entries(p).filter(([k]) => k !== "name")) };
    if (!info.firstName && !info.lastName && p.name) {
        const parts = p.name.split(/\s+/).filter(Boolean);
        info.firstName = parts[0] ?? "";
        info.lastName = parts.slice(1).join(" ");
    }
    // Same normalisation as a save (phone format, full link URLs); what can't be fixed is reported.
    const contact = normalizeContact(info);
    data.personalInfo = contact.info;
    data.links = normalizeLinks(readLinks(env.links)).links;
    if (contact.issues.email?.level === "error") warnings.push(`The email address "${contact.issues.email.value}" looks invalid; fix it before saving.`);
    if (contact.issues.phone?.level === "warning") warnings.push(`Check the phone number "${contact.issues.phone.value}".`);

    /** `reject` returns a reason to skip the item, or null to keep it. */
    function convert<K extends ResumeListKey, S extends z.ZodTypeAny>(
        key: K,
        schema: S,
        reject: (x: z.infer<S>) => string | null,
        map: (x: z.infer<S>) => Omit<ResumeData[K][number], "id" | "isSelected" | "tags" | "tagsHash" | "hidden">,
    ) {
        (env[key] as unknown[]).forEach((item, i) => {
            const r = schema.safeParse(item);
            if (!r.success) {
                warnings.push(`Skipped ${LABELS[key]} #${i + 1}: it could not be read.`);
                return;
            }
            const reason = reject(r.data);
            if (reason) {
                const name = firstText(r.data);
                warnings.push(`Skipped ${LABELS[key]} #${i + 1}${name ? ` (${name})` : ""}: ${reason}.`);
                return;
            }
            (data[key] as unknown[]).push({ id: newTempId(), isSelected: true, tags: [], tagsHash: null, hidden: [], ...map(r.data) });
        });
    }

    const missing = (label: string) => (ok: boolean) => (ok ? null : `it had no ${label}`);

    convert("workExperience", experience, x => missing("title or company")(Boolean(x.title || x.company)), x => ({
        title: x.title, company: x.company, ...normalizeDateRange(x.startDate, x.endDate), description: x.bullets.join("\n"),
    }));
    convert("education", education, x => missing("degree or institution")(Boolean(x.degree || x.institution)), x => ({
        degree: x.degree, institution: x.institution, ...normalizeDateRange(x.startDate, x.endDate),
        gpa: x.gpa, minor: x.minor, details: x.details,
    }));
    convert("skills", skill, x => missing("skills listed")(x.items.length > 0), x => ({
        category: x.category || "Skills", items: x.items.join(", "),
    }));
    convert("projects", project, x => missing("title")(Boolean(x.title)), x => ({
        title: x.title, stack: x.stack, link: x.link, ...normalizeDateRange(x.startDate, x.endDate), description: x.bullets.join("\n"),
    }));
    convert("certifications", certification, x => missing("name")(Boolean(x.name)), x => ({
        name: x.name, issuer: x.issuer, year: normalizeYear(x.year), credentialId: x.credentialId.slice(0, 60),
        expires: normalizeImportedDate(x.expires).replace(/^Present$/, "").slice(0, 7),
    }));
    convert("awards", award, x => missing("title")(Boolean(x.title)), x => ({
        title: x.title, issuer: x.issuer, date: normalizeImportedDate(x.date).replace(/^Present$/, ""), description: x.description,
    }));
    convert("volunteering", volunteering, x => missing("role or organization")(Boolean(x.role || x.organization)), x => ({
        role: x.role, organization: x.organization, ...normalizeDateRange(x.startDate, x.endDate), description: x.bullets.join("\n"),
    }));
    convert("publications", publication, x => missing("title")(Boolean(x.title)), x => ({
        title: x.title, venue: x.venue, date: normalizeImportedDate(x.date).replace(/^Present$/, ""), link: x.link, authors: x.authors,
    }));
    convert("languages", language, x => missing("language name")(Boolean(x.language)), x => ({
        language: x.language, proficiency: x.proficiency,
    }));
    convert("custom", custom, x => missing("title")(Boolean(x.title)), x => ({
        section: x.section.slice(0, 60) || "Other", title: x.title, subtitle: x.subtitle, ...normalizeDateRange(x.startDate, x.endDate), description: x.bullets.join("\n"),
    }));

    return { data: clampResumeData(data), warnings };
}
