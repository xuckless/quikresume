// src/lib/import/match.ts
// Pure fuzzy identity for imported items. The vision model re-reads a résumé
// on every import and rarely returns byte-identical text ("Google LLC" vs
// "Google", "B.S." vs "Bachelor of Science", "2021" vs "Jun 2021"), and saving
// replaces empty required fields with placeholders ("Unknown Company"). An
// exact key misses all of these, so a second import of the same file used to
// append duplicates. Matching here is deterministic: canonical text, token
// similarity, and year-level dates.

import type { ResumeData, ResumeListKey } from "@/types/schema";
import { parseDateParts } from "@/lib/dates";
import { PLACEHOLDER } from "@/lib/sections";

type AnyItem = ResumeData[ResumeListKey][number];

/** Skills category names that mean "no name": the save placeholder and the import fallback. */
export const SKILL_CATEGORY_PLACEHOLDERS: readonly string[] = [PLACEHOLDER.skillCategory.toLowerCase(), "skills"];

const PLACEHOLDERS = new Set(Object.values(PLACEHOLDER).map(v => v.toLowerCase()).concat(SKILL_CATEGORY_PLACEHOLDERS, ["untitled"]));

const ORG_SUFFIXES = new Set(["inc", "llc", "ltd", "limited", "corp", "corporation", "co", "company", "gmbh", "plc", "llp", "pty", "sa", "ag", "bv"]);

/** Multi-token expansions applied to the dotted/abbreviated forms before punctuation is stripped. */
const PHRASES: [RegExp, string][] = [
    [/\bb\.?\s?sc?\.?(?=\s|$|,)/g, "bachelor of science"],
    [/\bb\.?\s?a\.?(?=\s|$|,)/g, "bachelor of arts"],
    [/\bb\.?\s?eng\.?(?=\s|$|,)/g, "bachelor of engineering"],
    [/\bm\.?\s?sc?\.?(?=\s|$|,)/g, "master of science"],
    [/\bm\.?\s?a\.?(?=\s|$|,)/g, "master of arts"],
    [/\bm\.?\s?b\.?\s?a\.?(?=\s|$|,)/g, "master of business administration"],
    [/\bm\.?\s?eng\.?(?=\s|$|,)/g, "master of engineering"],
    [/\bph\.?\s?d\.?(?=\s|$|,)/g, "doctor of philosophy"],
];

const WORDS: Record<string, string> = {
    sr: "senior", jr: "junior", mgr: "manager", eng: "engineer", engr: "engineer", dev: "developer",
    swe: "software engineer", univ: "university", intl: "international", dept: "department", asst: "assistant",
    assoc: "associate", mgmt: "management", tech: "technology", comp: "computer", sci: "science",
};

const STOP = new Set(["of", "in", "the", "at", "and", "for", "a", "an"]);

/** Lowercase, accents and punctuation stripped, abbreviations expanded, whitespace squashed. */
export function canon(s: string | null | undefined): string {
    let t = (s ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    if (PLACEHOLDERS.has(t)) return "";
    t = t.replace(/&/g, " and ").replace(/[–—]/g, "-");
    for (const [re, rep] of PHRASES) t = t.replace(re, rep);
    t = t.replace(/[^a-z0-9+#]+/g, " ").trim();
    return t.split(/\s+/).filter(Boolean).map(w => WORDS[w] ?? w).join(" ");
}

/** Canonical organisation name: legal suffixes dropped. */
export function canonOrg(s: string | null | undefined): string {
    const tokens = canon(s).split(" ").filter(Boolean);
    while (tokens.length > 1 && ORG_SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
    return tokens.join(" ");
}

const tokenSet = (s: string) => new Set(s.split(" ").filter(w => w && !STOP.has(w)));

/** Token-set Dice similarity on canonical strings; containment of a full multi-word token set counts as a match. */
export function similarity(a: string, b: string): number {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const A = tokenSet(a), B = tokenSet(b);
    if (A.size === 0 || B.size === 0) return 0;
    let shared = 0;
    for (const w of A) if (B.has(w)) shared++;
    // "Distributed Tracing" inside "Distributed Tracing Platform": containment of a multi-word set.
    if (Math.min(A.size, B.size) >= 2 && shared === Math.min(A.size, B.size)) return 1;
    return (2 * shared) / (A.size + B.size);
}

export const SIMILAR = 0.8;

const similar = (a: string, b: string) => similarity(a, b) >= SIMILAR;
/** Both empty or similar; one side empty only when `allowOneEmpty`. */
const compatible = (a: string, b: string, allowOneEmpty: boolean) => (!a && !b) || ((!a || !b) ? allowOneEmpty : similar(a, b));

const yearOf = (s: string) => parseDateParts(s)?.y ?? null;
const sameYearOrMissing = (a: string, b: string) => {
    const x = yearOf(a), y = yearOf(b);
    return x === null || y === null || x === y;
};

/** Whether `a` and `b` describe the same thing. */
export function sameItem(key: ResumeListKey, a: AnyItem, b: AnyItem): boolean {
    const x = a as unknown as Record<string, string>;
    const y = b as unknown as Record<string, string>;
    switch (key) {
        case "workExperience": {
            const company = compatible(canonOrg(x.company), canonOrg(y.company), true);
            const title = compatible(canon(x.title), canon(y.title), true);
            // Needs at least one field actually present on both sides.
            const anchored = (canonOrg(x.company) && canonOrg(y.company)) || (canon(x.title) && canon(y.title));
            return Boolean(anchored) && company && title && sameYearOrMissing(x.startDate, y.startDate);
        }
        case "education": {
            const inst = compatible(canonOrg(x.institution), canonOrg(y.institution), true);
            const degree = compatible(canon(x.degree), canon(y.degree), true);
            const anchored = (canonOrg(x.institution) && canonOrg(y.institution)) || (canon(x.degree) && canon(y.degree));
            return Boolean(anchored) && inst && degree;
        }
        case "volunteering": {
            const org = compatible(canonOrg(x.organization), canonOrg(y.organization), true);
            const role = compatible(canon(x.role), canon(y.role), true);
            const anchored = (canonOrg(x.organization) && canonOrg(y.organization)) || (canon(x.role) && canon(y.role));
            return Boolean(anchored) && org && role;
        }
        case "projects":
        case "publications":
            return similar(canon(x.title), canon(y.title));
        case "certifications":
            return similar(canon(x.name), canon(y.name));
        case "awards":
            return similar(canon(x.title), canon(y.title)) && compatible(canonOrg(x.issuer), canonOrg(y.issuer), true);
        case "skills":
            // "General" / "Skills" placeholders canonicalise to "" and match each other.
            return canon(x.category) === canon(y.category);
        case "languages":
            return canon(x.language) !== "" && canon(x.language) === canon(y.language);
        case "custom":
            return canon(x.section) === canon(y.section) && similar(canon(x.title), canon(y.title)) && compatible(canonOrg(x.subtitle), canonOrg(y.subtitle), true);
    }
    return false;
}

/** Index of the item in `list` that `item` duplicates, or -1. */
export function findMatch<K extends ResumeListKey>(key: K, list: readonly ResumeData[K][number][], item: ResumeData[K][number]): number {
    return list.findIndex(existing => sameItem(key, existing, item));
}
