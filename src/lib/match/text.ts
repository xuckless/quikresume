// src/lib/match/text.ts
// Literal keyword checks over the exact text the Typst templates print
// (what a real ATS scans). Pure.

import type { TypstResumeDoc } from "@/lib/typst/doc";

/** Every string the template will print, one per line. */
export function renderedText(doc: TypstResumeDoc): string {
    const out: string[] = [];
    const push = (v: unknown) => {
        if (typeof v === "string") { if (v.trim()) out.push(v); }
        else if (Array.isArray(v)) v.forEach(push);
        else if (v && typeof v === "object") Object.values(v).forEach(push);
    };
    // Layout is spacing and section keys, never printed.
    const { layout: _layout, ...printed } = doc;
    void _layout;
    push(printed);
    return out.join("\n");
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Case-insensitive whole-word search; tolerant of terms like "C++", ".NET", "CI/CD". */
export function literalHit(text: string, forms: string[]): boolean {
    const lower = text.toLowerCase();
    for (const f of forms) {
        const needle = f.trim().toLowerCase();
        if (!needle) continue;
        const startWord = /^[a-z0-9]/.test(needle) ? "(?<![a-z0-9])" : "";
        const endWord = /[a-z0-9]$/.test(needle) ? "(?![a-z0-9])" : "";
        if (new RegExp(`${startWord}${escapeRe(needle)}${endWord}`, "i").test(lower)) return true;
    }
    return false;
}

/**
 * Qualifier words a posting adds to a skill name ("REST API Design", "Backend Development") that a
 * résumé rarely prints next to it. Dropped before the close-wording check below.
 */
const QUALIFIER_WORDS = new Set([
    "design", "development", "developing", "engineering", "management", "experience", "skills", "skill",
    "practices", "practice", "principles", "knowledge", "proficiency", "expertise", "and", "or", "of", "the", "with", "in", "for",
]);

/** Too broad to stand alone once the qualifier is gone ("Software Engineering" -> "software"). */
const BROAD_WORDS = new Set([
    "software", "data", "web", "system", "project", "product", "business", "technical", "application", "service",
    "customer", "team", "client", "program", "process", "quality", "computer", "information", "digital", "general",
]);

const wordStem = (w: string) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
const wordsOf = (s: string) => (s.toLowerCase().match(/[a-z0-9][a-z0-9+#.]*/g) ?? []).map(w => wordStem(w.replace(/\.+$/, "")));

/**
 * The same requirement in close wording on one printed line: every core word of a multi-word name
 * (qualifiers dropped, plural "s" ignored) appears as a whole word on the same line. "REST API Design"
 * finds "Wrote REST APIs with Django"; "Backend Development" finds "Backend engineer with 5 years".
 * Single-word names never use this (they are literal or nothing), and a lone core word must be at
 * least 4 characters and not a broad word, so "Go Development" can't match the verb "go" and
 * "Software Engineering" can't match any line that says "software".
 */
export function closeWordingHit(text: string, display: string): boolean {
    const all = wordsOf(display);
    if (all.length < 2) return false;
    const core = all.filter(w => !QUALIFIER_WORDS.has(w));
    if (core.length === 0) return false;
    if (core.length === 1 && (core[0].length < 4 || BROAD_WORDS.has(core[0]))) return false;
    return text.split("\n").some(line => {
        const words = new Set(wordsOf(line));
        return core.every(w => words.has(w));
    });
}
