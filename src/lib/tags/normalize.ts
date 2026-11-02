// src/lib/tags/normalize.ts
// Tag identity. The model is asked for canonical names, and this module makes
// "JS", "Javascript" and "JavaScript" collapse onto one key: lowercase, trimmed,
// then folded through the built-in alias table and the user's own aliases
// (model-reported, stored in users/{uid}/meta/tags). Pure; used on both sides.

import { isTagKind, type Tag, type TagKind } from "@/lib/tags/types";

export type AliasMap = Record<string, string>;

/** alias -> canonical key. Keys and values are already normalised. */
export const BUILTIN_ALIASES: AliasMap = {
    js: "javascript", ts: "typescript", py: "python", golang: "go", cpp: "c++", "c plus plus": "c++",
    csharp: "c#", "c sharp": "c#", "dotnet": ".net", "asp.net core": "asp.net",
    node: "node.js", nodejs: "node.js", "node js": "node.js",
    reactjs: "react", "react.js": "react", "react js": "react", vue: "vue.js", vuejs: "vue.js", "angularjs": "angular",
    nextjs: "next.js", "next js": "next.js", expressjs: "express", "express.js": "express",
    postgres: "postgresql", psql: "postgresql", mongo: "mongodb", mssql: "microsoft sql server",
    "sql server": "microsoft sql server", "ms sql": "microsoft sql server", "my sql": "mysql",
    k8s: "kubernetes", aws: "amazon web services", "amazon aws": "amazon web services",
    gcp: "google cloud", "google cloud platform": "google cloud", "azure": "microsoft azure",
    ml: "machine learning", ai: "artificial intelligence", dl: "deep learning", nlp: "natural language processing",
    "gen ai": "generative ai", genai: "generative ai", llms: "large language models", llm: "large language models",
    "ci cd": "ci/cd", "ci-cd": "ci/cd", cicd: "ci/cd", "continuous integration": "ci/cd", "continuous delivery": "ci/cd",
    "continuous deployment": "ci/cd", "continuous integration/continuous delivery": "ci/cd",
    "rest api": "rest apis", "restful apis": "rest apis", "restful api": "rest apis", "restful": "rest apis",
    "graph ql": "graphql", "sci-kit learn": "scikit-learn", sklearn: "scikit-learn",
    oop: "object-oriented programming", "object oriented programming": "object-oriented programming",
    ux: "user experience", ui: "user interface", "ui/ux": "ui/ux design", html5: "html", css3: "css",
    "tailwind": "tailwind css", tailwindcss: "tailwind css", "github action": "github actions",
    "data structures and algorithms": "data structures & algorithms", dsa: "data structures & algorithms",
    "agile methodologies": "agile", "agile methodology": "agile", "scrum methodology": "scrum",
    "test driven development": "test-driven development", tdd: "test-driven development",
    "b.sc": "bachelor of science", bsc: "bachelor of science", "b.s.": "bachelor of science", bs: "bachelor of science",
    "m.sc": "master of science", msc: "master of science", "m.s.": "master of science",
    "b.eng": "bachelor of engineering", beng: "bachelor of engineering", "b.a.": "bachelor of arts",
    "comp sci": "computer science", "compsci": "computer science",
    "bachelors": "bachelor's degree", "bachelor's": "bachelor's degree", "bachelors degree": "bachelor's degree",
    "bachelor degree": "bachelor's degree", "bachelor's degrees": "bachelor's degree", "undergraduate degree": "bachelor's degree",
    "ba/bs": "bachelor's degree", "bs/ba": "bachelor's degree", "bs/ms": "bachelor's degree",
    "masters": "master's degree", "master's": "master's degree", "masters degree": "master's degree", "master degree": "master's degree",
    "graduate degree": "master's degree", "ms/phd": "master's degree",
    "phd": "doctorate", "ph.d": "doctorate", "ph.d.": "doctorate", "doctoral degree": "doctorate", "doctor of philosophy": "doctorate",
    "degree": "university degree", "college degree": "university degree", "university degree": "university degree",
    "relevant degree": "university degree", "related degree": "university degree",
    microservice: "microservices", "micro-services": "microservices", "micro services": "microservices",
    "microservice architecture": "microservices", "microservices architecture": "microservices", "microservices-based architecture": "microservices",
    "service-oriented architecture": "microservices", "service oriented architecture": "microservices", soa: "microservices",
    "cs degree": "computer science", "computer science degree": "computer science", "computer sciences": "computer science",
    "software engineer": "software engineering", "software development": "software engineering", "software dev": "software engineering",
    // Degrees beyond tech (abbreviations that only ever mean the degree).
    bsn: "bachelor of science in nursing", "b.s.n.": "bachelor of science in nursing", "b.sc.n": "bachelor of science in nursing",
    bscn: "bachelor of science in nursing", "b.ed": "bachelor of education", "b.ed.": "bachelor of education",
    bba: "bachelor of business administration", "b.b.a.": "bachelor of business administration", bcom: "bachelor of commerce",
    "b.com": "bachelor of commerce", llb: "bachelor of laws", "ll.b": "bachelor of laws", "ll.b.": "bachelor of laws",
    mbbs: "bachelor of medicine and surgery", msn: "master of science in nursing", "m.ed": "master of education", "m.ed.": "master of education",
    mfa: "master of fine arts", mph: "master of public health", mba: "master of business administration", "m.b.a.": "master of business administration",
    "ll.m": "master of laws", "ll.m.": "master of laws", "m.d.": "doctor of medicine", jd: "juris doctor", "j.d.": "juris doctor",
    pharmd: "doctor of pharmacy", "pharm.d": "doctor of pharmacy", "pharm.d.": "doctor of pharmacy", edd: "doctor of education",
    "ed.d": "doctor of education", "ed.d.": "doctor of education", dnp: "doctor of nursing practice",
    // Licences.
    rn: "registered nurse", "rn license": "registered nurse", "rn licence": "registered nurse", "registered nurse license": "registered nurse",
    "registered nurse licence": "registered nurse", "active rn license": "registered nurse", "active rn licence": "registered nurse",
    lpn: "licensed practical nurse", lvn: "licensed practical nurse", "licensed vocational nurse": "licensed practical nurse",
    "rpn": "licensed practical nurse", "registered practical nurse": "licensed practical nurse", np: "nurse practitioner",
    cpa: "certified public accountant", "cpa license": "certified public accountant", "cpa licence": "certified public accountant",
    pmp: "project management professional", "journeyman license": "journeyman electrician", "journeyman licence": "journeyman electrician",
    "journeyperson electrician": "journeyman electrician",
};

/** Pretty forms for canonical keys the alias table produces (otherwise the model's spelling is kept). */
const DISPLAY_NAMES: Record<string, string> = {
    javascript: "JavaScript", typescript: "TypeScript", python: "Python", go: "Go", "c++": "C++", "c#": "C#", ".net": ".NET",
    "asp.net": "ASP.NET", "node.js": "Node.js", react: "React", "vue.js": "Vue.js", angular: "Angular", "next.js": "Next.js",
    express: "Express", postgresql: "PostgreSQL", mongodb: "MongoDB", "microsoft sql server": "Microsoft SQL Server", mysql: "MySQL",
    kubernetes: "Kubernetes", "amazon web services": "Amazon Web Services", "google cloud": "Google Cloud", "microsoft azure": "Microsoft Azure",
    "machine learning": "Machine Learning", "artificial intelligence": "Artificial Intelligence", "deep learning": "Deep Learning",
    "natural language processing": "Natural Language Processing", "computer vision": "Computer Vision", "generative ai": "Generative AI",
    "large language models": "Large Language Models", "ci/cd": "CI/CD", "rest apis": "REST APIs", graphql: "GraphQL", tensorflow: "TensorFlow",
    "scikit-learn": "scikit-learn", "object-oriented programming": "Object-Oriented Programming", "user experience": "User Experience",
    "user interface": "User Interface", "ui/ux design": "UI/UX Design", html: "HTML", css: "CSS", "tailwind css": "Tailwind CSS",
    "github actions": "GitHub Actions", "data structures & algorithms": "Data Structures & Algorithms", agile: "Agile", scrum: "Scrum",
    "test-driven development": "Test-Driven Development", "bachelor of science": "Bachelor of Science", "master of science": "Master of Science",
    "bachelor of engineering": "Bachelor of Engineering", "bachelor of arts": "Bachelor of Arts", "computer science": "Computer Science",
    "bachelor's degree": "Bachelor's Degree", "master's degree": "Master's Degree", doctorate: "Doctorate", "university degree": "University Degree",
    microservices: "Microservices", "software engineering": "Software Engineering",
    "bachelor of science in nursing": "Bachelor of Science in Nursing", "bachelor of education": "Bachelor of Education",
    "bachelor of business administration": "Bachelor of Business Administration", "bachelor of commerce": "Bachelor of Commerce",
    "bachelor of laws": "Bachelor of Laws", "bachelor of medicine and surgery": "MBBS", "master of science in nursing": "Master of Science in Nursing",
    "master of education": "Master of Education", "master of fine arts": "Master of Fine Arts", "master of public health": "Master of Public Health",
    "master of business administration": "MBA", "master of laws": "Master of Laws", "doctor of medicine": "Doctor of Medicine",
    "juris doctor": "Juris Doctor", "doctor of pharmacy": "Doctor of Pharmacy", "doctor of education": "Doctor of Education",
    "doctor of nursing practice": "Doctor of Nursing Practice", "registered nurse": "Registered Nurse", "licensed practical nurse": "Licensed Practical Nurse",
    "nurse practitioner": "Nurse Practitioner", "certified public accountant": "CPA", "project management professional": "PMP",
    "journeyman electrician": "Journeyman Electrician",
};

/**
 * Built-in implications: a requirement key on the left is satisfied by any
 * candidate tag key matching the pattern on the right. This is the deterministic
 * floor under the LLM reconcile pass, so degree levels resolve even offline
 * ("bachelor's degree" <- "bachelor of science", "b.eng"...).
 */
const BUILTIN_SATISFIERS: Array<[requirement: string, pattern: RegExp]> = [
    ["bachelor's degree", /^(bachelor(?:'s)? (?:of|in) |b\.?(?:sc|s|a|eng|e|tech|comp|cs|ba)\b|bachelor's degree in |master|doctor|phd|juris doctor)/],
    ["master's degree", /^(master(?:'s)? (?:of|in) |m\.?(?:sc|s|a|eng|e|tech|ba|phil)\b|master's degree in |doctorate|doctor of |phd|juris doctor)/],
    ["doctorate", /^(doctor of |phd\b|ph\.d|juris doctor)/],
    ["university degree", /^(bachelor|master|doctor|phd|associate|juris doctor|b\.?(?:sc|s|a|eng|e|tech)\b|m\.?(?:sc|s|a|eng|e|tech|ba)\b)/],
    // Licence ladders: the higher licence requires the lower one.
    ["registered nurse", /^(nurse practitioner|advanced practice registered nurse|clinical nurse specialist|certified registered nurse anesthetist)/],
    ["licensed practical nurse", /^(registered nurse|nurse practitioner)/],
    ["journeyman electrician", /^master electrician/],
];

/** Candidate tag keys (from `inventory`) that satisfy `requirement` through the built-in hierarchy. */
export function builtinSatisfiers(requirement: string, inventory: Iterable<string>): string[] {
    const rules = BUILTIN_SATISFIERS.filter(([req]) => req === requirement);
    if (rules.length === 0) return [];
    const out: string[] = [];
    for (const key of inventory) {
        if (key !== requirement && rules.some(([, re]) => re.test(key))) out.push(key);
    }
    return out;
}

/** Lowercase, trimmed, single-spaced, outer quotes and trailing punctuation stripped. */
export function normalizeTagName(raw: string): string {
    return raw
        .trim()
        .replace(/^["'`]+|["'`]+$/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/[.,;:!]+$/g, "")
        .trim();
}

/** Normalised raw name -> canonical key. Built-in aliases win over user aliases. */
export function canonicalKey(raw: string, userAliases: AliasMap = {}): string {
    const n = normalizeTagName(raw);
    if (n === "") return "";
    return BUILTIN_ALIASES[n] ?? userAliases[n] ?? n;
}

export function makeTag(rawName: string, kind: TagKind, userAliases: AliasMap = {}): Tag | null {
    const name = canonicalKey(rawName, userAliases);
    if (!name) return null;
    const display = DISPLAY_NAMES[name] ?? (normalizeTagName(rawName) === name ? rawName.trim().replace(/[.,;:!]+$/g, "") : name);
    return { name, display, kind };
}

/** Keeps the first occurrence of each name. */
export function dedupeTags(tags: Tag[]): Tag[] {
    const seen = new Set<string>();
    const out: Tag[] = [];
    for (const t of tags) {
        if (seen.has(t.name)) continue;
        seen.add(t.name);
        out.push(t);
    }
    return out;
}

/** Lenient reader for `{name, kind, aliases?}` rows straight from the model. */
export function tagsFromModel(rows: unknown, userAliases: AliasMap = {}): Tag[] {
    if (!Array.isArray(rows)) return [];
    const out: Tag[] = [];
    for (const r of rows) {
        if (!r || typeof r !== "object") continue;
        const o = r as Record<string, unknown>;
        if (typeof o.name !== "string" || !isTagKind(o.kind)) continue;
        const t = makeTag(o.name, o.kind, userAliases);
        if (t) out.push(t);
    }
    return dedupeTags(out);
}

/**
 * Filters aliases the model reported: keeps `alias -> canonical` only when the
 * canonical is one of the tag names actually returned, the alias is not already
 * a built-in alias, and the two differ. Returns normalised pairs.
 */
export function acceptModelAliases(reported: unknown, tagNames: Set<string>, userAliases: AliasMap = {}): AliasMap {
    const out: AliasMap = {};
    if (!reported || typeof reported !== "object") return out;
    for (const [aliasRaw, canonRaw] of Object.entries(reported as Record<string, unknown>)) {
        if (typeof canonRaw !== "string") continue;
        const alias = normalizeTagName(aliasRaw);
        const canon = canonicalKey(canonRaw, userAliases);
        if (!alias || !canon || alias === canon) continue;
        if (alias in BUILTIN_ALIASES || alias in userAliases) continue;
        if (!tagNames.has(canon)) continue;
        if (alias.length < 2) continue;
        out[alias] = canon;
    }
    return out;
}

/** All surface forms that should count as a literal mention of `name`. */
export function surfaceForms(name: string, userAliases: AliasMap = {}): string[] {
    const forms = new Set<string>([name]);
    for (const [alias, canon] of Object.entries(BUILTIN_ALIASES)) if (canon === name) forms.add(alias);
    for (const [alias, canon] of Object.entries(userAliases)) if (canon === name) forms.add(alias);
    return [...forms];
}
