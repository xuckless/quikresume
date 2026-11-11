// LinkedIn profile page -> ImportEnvelope (src/lib/import/envelope.ts), parsed from the DOM in the
// profile tab (entrypoints/linkedin-profile.content.ts). No AI here: the app validates the result with the
// same lenient schema as file import; lib/profile-merge.ts `needsAnalysis` says when it is unsure.
//
// Markup facts relied on (LinkedIn's signed-in, server-driven profile, checked against a saved live page
// in 2026-11; anonymised copy in __fixtures__/linkedin-profile-2026.html). Class names are obfuscated
// and never used.
//   - The profile column is <main> > [data-view-name="profile-main-level"] > [data-testid="lazy-column"];
//     recommendations sit in an <aside> inside <main>. There is no <h1>; card headings are <h2>.
//   - The top card is [data-view-name="profile-top-card"]: the name is its <h2>; the headline is the
//     first plain line after it (after pronouns); the location shares a line block with the
//     "/overlay/contact-info/" link. Links, chips ([role=button]) and the carousel are noise.
//   - Each section is [data-view-name="profile-card-<section id with dashes>"] (profile-card-experience,
//     -education, -skills, -about, -licenses-and-certifications, -volunteering-experience, ...). A card
//     may contain a second element with its own view name (education does): the outermost one counts.
//   - Entries are the outermost [componentkey^="entity-collection-item"] elements of a card. Their lines
//     are <p> blocks in order: title, "Company · Employment type", "Sep 2025 - Dec 2025 · 4 mos" (also
//     "2021 – Dec 2022"), "City, Region, Country · On-site". A lone "Present" marker may appear.
//   - Descriptions are [data-testid="expandable-text-box"] spans with <br> line breaks; the "… more"
//     control inside is button[data-testid="expandable-text-button"]. Bullets start with "•".
//   - "X, Y and +N skills" lines are links to /overlay/<id>/skill-associations-details/: dropped (the
//     Skills card holds the full list).
//   - Every card has edit / add pencils linking to /details/<section>/ with a data-view-name; the real
//     "Show all" link has none and sits outside the entries. Cut-short cards are reported with a warning.
// Older markup (2024-25: <section>s with an anchor <div id="experience">, entries as <li>s, text in
// span[aria-hidden]) is still read as a fallback.
// Each section parser fails on its own: a section it cannot read becomes a warning and an `unread` key.

import type { ImportEnvelope } from "../../src/lib/import/envelope";
import { canonicalProfileUrl } from "../../src/lib/import/linkedin";
import type { CaptureResult, ReadKey } from "./profile-merge";

export const SELECTORS = {
    /** The page's main column. */
    main: 'main, [role="main"], .scaffold-layout__main',
    /** Logged-out pages: the sign-in form, LinkedIn's auth wall, the sign-in modal on public profiles. */
    loginWall: 'input[type="password"], form[action*="login"], .authwall, .authwall-join-form, .contextual-sign-in-modal',
    topCard: '[data-view-name="profile-top-card"]',
    /** Any profile card (recognised or not). */
    anyCard: '[data-view-name^="profile-card-"]',
    entry: '[componentkey^="entity-collection-item"]',
    textBox: '[data-testid="expandable-text-box"]',
    /** "… more" inside a description: the only control the capture clicks (plus the old "…see more"). */
    expand: 'button[data-testid="expandable-text-button"]',
    skillsLink: 'a[href*="/skill-associations-details/"]',
    contactInfo: 'a[href*="/overlay/contact-info"]',
    /** Old markup: visible text pieces (their visually-hidden twins are for screen readers). */
    piece: 'span[aria-hidden="true"]',
    /** Old markup: collapsed "…see more" text. */
    seeMore: 'button[aria-expanded="false"]',
    /** Never text: controls, icons, images. */
    skip: "button, svg, img, script, style, figure, template",
} as const;

/** Card id (old anchor id; view name with dashes) -> label used in warnings. */
export const SECTIONS = {
    about: "About",
    experience: "Experience",
    education: "Education",
    skills: "Skills",
    projects: "Projects",
    licenses_and_certifications: "Licenses & certifications",
    honors_and_awards: "Honors & awards",
    volunteering_experience: "Volunteering",
    publications: "Publications",
    languages: "Languages",
    organizations: "Organizations",
    courses: "Courses",
    patents: "Patents",
    test_scores: "Test scores",
} as const;
export type SectionId = keyof typeof SECTIONS;
const SECTION_IDS = Object.keys(SECTIONS) as SectionId[];
/** Recognised cards with no section of their own: imported as custom entries under their heading. */
const CUSTOM_SECTIONS: SectionId[] = ["organizations", "courses", "patents", "test_scores"];
/** Where each card lands in the envelope. */
const SECTION_KEY: Record<SectionId, ReadKey> = {
    about: "summary", experience: "workExperience", education: "education", skills: "skills", projects: "projects",
    licenses_and_certifications: "certifications", honors_and_awards: "awards", volunteering_experience: "volunteering",
    publications: "publications", languages: "languages", organizations: "custom", courses: "custom", patents: "custom", test_scores: "custom",
};

export class CaptureError extends Error {}

export const CAPTURE_ERRORS = {
    mismatch: "This tab is not the LinkedIn profile saved in quikResume.",
    loginWall: "Sign in to LinkedIn and open your profile, then click Import.",
    notLoaded: "Your profile hasn't finished loading. Wait until you can see it, then click Import.",
};

// ---------- Text ----------

const clean = (s: string) => s.replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{2,}/g, "\n").trim();
const BLOCK = new Set(["P", "DIV", "SECTION", "ARTICLE", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6", "DT", "DD", "HR", "HEADER", "FOOTER", "TABLE", "TR"]);

/** Text lines of `root`: block elements and <br> break lines, controls and `skip` subtrees left out. */
function linesOf(root: Element, skip: (el: Element) => boolean = () => false): string[] {
    const out: string[] = [];
    let line = "";
    const flush = () => {
        for (const l of clean(line).split("\n")) if (l) out.push(l);
        line = "";
    };
    const walk = (node: Node) => {
        for (const child of Array.from(node.childNodes)) {
            if (child.nodeType === 3) line += child.textContent ?? "";
            if (child.nodeType !== 1) continue;
            const el = child as Element;
            if (el.tagName === "BR") { line += "\n"; continue; }
            if (el.matches(SELECTORS.skip) || skip(el)) continue;
            const block = BLOCK.has(el.tagName);
            if (block) flush();
            walk(el);
            if (block) flush();
        }
    };
    if (!root.matches(SELECTORS.skip)) walk(root);
    flush();
    return out.filter((l, i) => l !== out[i - 1]);
}

/** Old markup: text of an element with <br> as a line break and controls left out. */
function textOf(el: Element): string {
    const copy = el.cloneNode(true) as Element;
    copy.querySelectorAll(SELECTORS.skip).forEach(x => x.remove());
    copy.querySelectorAll("br").forEach(br => br.replaceWith("\n"));
    return clean(copy.textContent ?? "");
}

/** Old markup: text of every innermost element under `root`, in order, consecutive duplicates dropped. */
function leaves(root: Element, inScope: (el: Element) => boolean = () => true): string[] {
    const texts = Array.from(root.querySelectorAll("*"))
        .filter(el => inScope(el) && !el.closest(SELECTORS.skip) && el.tagName !== "BR" && Array.from(el.children).every(c => c.tagName === "BR"))
        .map(textOf)
        .filter(Boolean);
    return texts.filter((t, i) => t !== texts[i - 1]);
}

/** Old markup: the visible text pieces under `root`, in order, leaving out anything inside `exclude`. */
function pieces(root: Element, exclude: Element | null = null): string[] {
    const inScope = (el: Element) => !(exclude && exclude.contains(el)) && !el.closest(SELECTORS.skip);
    const found = Array.from(root.querySelectorAll(SELECTORS.piece)).filter(el => inScope(el) && !el.parentElement?.closest(SELECTORS.piece));
    return found.length > 0 ? found.map(textOf).filter(Boolean) : leaves(root, inScope);
}

/** Elements matching `selector` under `root` that are not inside another match (nor in the aside). */
function outermost(root: Element, selector: string): Element[] {
    return Array.from(root.querySelectorAll(selector)).filter(el => !el.parentElement?.closest(selector) && !el.closest("aside"));
}

// ---------- Entries ----------

interface Entry {
    /** The entry's own lines: title, subtitle, dates, location... */
    lines: string[];
    /** Description lines. */
    details: string[];
    /** Several roles under one company. */
    roles: Entry[];
    /** First off-LinkedIn link in the entry. */
    link: string;
}

const MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?";
const DATE = `(?:${MONTH}\\s+)?(?:19|20)\\d{2}`;
/** "Jan 2021 - Present · 3 yrs", "2015 – 2019", "Mar 2020", with an optional "Issued" in front. */
const DATE_LINE = new RegExp(`^(?:Issued\\s+)?${DATE}(?:\\s*[-–—]\\s*(?:${DATE}|Present))?(?:\\s*·.*)?$`, "i");
export const isDateLine = (line: string) => DATE_LINE.test(line.trim());
/** "Escorted Tours, Guided Tours and +4 skills": a summary of the entry's skills, not content. */
const SKILLS_SUMMARY = /\band \+\d+ skills?$/i;

/** "Jan 2021 - Present · 3 yrs 2 mos" -> ["Jan 2021", "Present"]; "2019" -> ["2019", ""]. */
export function splitDates(line: string): [string, string] {
    const range = (line.split("·")[0] ?? "").replace(/^Issued\s+/i, "").trim();
    const [start = "", end = ""] = range.split(/\s*[-–—]\s*/);
    return [start, end];
}

function externalLink(root: Element): string {
    for (const a of Array.from(root.querySelectorAll("a[href]"))) {
        try {
            const url = new URL(a.getAttribute("href") ?? "");
            if (url.protocol === "https:" && !/(^|\.)linkedin\.com$/.test(url.hostname)) return url.href;
        } catch { /* relative: LinkedIn's own UI */ }
    }
    return "";
}

/** Lines of an entry that are a role of its own (a title and a date line), not a description. */
const isRole = (lines: string[]) => lines.length >= 2 && lines.slice(1).some(isDateLine);

/** Current markup: one entity-collection item. Two or more nested items with dates = roles at one company. */
const SUB_ENTRY = `${SELECTORS.entry}, [role="listitem"], li`;

function readItem(item: Element): Entry {
    const nested = Array.from(item.querySelectorAll(SUB_ENTRY));
    const subs = nested.filter(el => !nested.some(other => other !== el && other.contains(el)));
    const roles = subs.map(readItem).filter(r => isRole(r.lines));
    const grouped = roles.length >= 2;
    const boxes = Array.from(item.querySelectorAll(SELECTORS.textBox));
    const own = (el: Element) => (grouped && subs.some(s => s.contains(el))) || boxes.some(b => b.contains(el)) || el.matches(SELECTORS.skillsLink);
    const lines = linesOf(item, own).filter(l => !/^present$/i.test(l) && !SKILLS_SUMMARY.test(l));
    const details = grouped ? [] : boxes.map(b => linesOf(b).join("\n")).filter(Boolean);
    return { lines, details, roles: grouped ? roles : [], link: externalLink(item) };
}

/** Old markup: one <li>, its nested <ul> holding the description or several roles. */
function readLi(li: Element): Entry {
    const nested = li.querySelector("ul");
    const entry: Entry = { lines: pieces(li, nested), details: [], roles: [], link: externalLink(li) };
    if (!nested) return entry;
    for (const child of Array.from(nested.children).filter(el => el.tagName === "LI")) {
        const own = readLi(child);
        if (isRole(own.lines)) entry.roles.push(own);
        else entry.details.push(...own.lines, ...own.details);
    }
    return entry;
}

/** The card's entries: entity-collection items, else (older markup) its outermost list items. */
function entries(section: Element): Entry[] {
    const items = outermost(section, SELECTORS.entry);
    const read = items.length > 0 ? items.map(readItem) : outermost(section, "li").map(readLi);
    return read.filter(e => e.lines.length > 0);
}

const hasEntries = (section: Element) => section.querySelector(`${SELECTORS.entry}, li`) !== null;

/** Description lines as bullets: split, unbulleted, without LinkedIn's "Skills: a · b" footer. */
function bullets(details: string[]): string[] {
    return details
        .flatMap(d => d.split("\n"))
        .map(l => l.replace(/^[-•*▪◦]\s*/, "").trim())
        .filter(l => l && !/^skills:/i.test(l) && !/…\s*(see )?more$/i.test(l) && !SKILLS_SUMMARY.test(l));
}

const before = (s: string, sep: string) => (s.split(sep)[0] ?? "").trim();
const dateLine = (lines: string[]) => lines.find(isDateLine) ?? "";
/** The line after the title and before the dates ("Company · Full-time"); without dates, the next line. */
function subtitle(lines: string[]): string {
    const at = lines.findIndex((l, i) => i > 0 && isDateLine(l));
    return lines.slice(1, at > 0 ? at : undefined).find(l => !isDateLine(l)) ?? "";
}

// ---------- Section parsers ----------

type Envelope = Required<ImportEnvelope>;

function experience(section: Element): Envelope["workExperience"] {
    return entries(section).flatMap(e => {
        if (e.roles.length > 0) {
            // Grouped: the entry is the company ("Example Inc", "Full-time · 5 yrs"), each role a child.
            const company = e.lines[0] ?? "";
            return e.roles.map(r => {
                const [startDate, endDate] = splitDates(dateLine(r.lines));
                return { title: r.lines[0] ?? "", company, startDate, endDate, bullets: bullets(r.details) };
            });
        }
        const [startDate, endDate] = splitDates(dateLine(e.lines));
        return [{ title: e.lines[0] ?? "", company: before(subtitle(e.lines), "·"), startDate, endDate, bullets: bullets(e.details) }];
    });
}

function education(section: Element): Envelope["education"] {
    return entries(section).map(e => {
        const [startDate, endDate] = splitDates(dateLine(e.lines));
        const grade = [...e.lines, ...e.details].find(l => /^grade:/i.test(l)) ?? "";
        const degree = subtitle(e.lines);
        return {
            degree: /^grade:/i.test(degree) ? "" : degree,
            institution: e.lines[0] ?? "",
            startDate, endDate,
            gpa: grade.replace(/^grade:\s*/i, ""),
            details: bullets(e.details.filter(l => !/^grade:/i.test(l))).join("\n"),
        };
    });
}

function skills(section: Element): Envelope["skills"] {
    const items = entries(section).map(e => e.lines[0] ?? "").filter(Boolean);
    return items.length ? [{ category: "Skills", items }] : [];
}

function projects(section: Element): Envelope["projects"] {
    return entries(section).map(e => {
        const [startDate, endDate] = splitDates(dateLine(e.lines));
        return { title: e.lines[0] ?? "", link: e.link, startDate, endDate, bullets: bullets(e.details) };
    });
}

function certifications(section: Element): Envelope["certifications"] {
    return entries(section).map(e => {
        const all = [...e.lines, ...e.details];
        const issued = all.find(l => /^issued\b/i.test(l)) ?? dateLine(e.lines);
        const expires = /expires\s+(.+)$/i.exec(issued)?.[1] ?? "";
        const credential = all.find(l => /^credential id\b/i.test(l)) ?? "";
        const issuer = e.lines.slice(1).find(l => !isDateLine(l) && !/^(issued|credential id)\b/i.test(l)) ?? "";
        return {
            name: e.lines[0] ?? "", issuer: before(issuer, "·"), year: splitDates(issued)[0],
            credentialId: credential.replace(/^credential id\s*/i, ""), expires: expires.trim(),
        };
    });
}

function awards(section: Element): Envelope["awards"] {
    return entries(section).map(e => {
        // "Issued by Example Foundation · Jan 2020"
        const issuedBy = e.lines.find(l => /^issued by\b/i.test(l)) ?? "";
        const [by, when = ""] = issuedBy.replace(/^issued by\s*/i, "").split(/\s*·\s*/);
        return {
            title: e.lines[0] ?? "", issuer: by ?? "", date: when || splitDates(dateLine(e.lines))[0],
            description: bullets(e.details.filter(l => !/^associated with\b/i.test(l))).join("\n"),
        };
    });
}

function volunteering(section: Element): Envelope["volunteering"] {
    return entries(section).map(e => {
        const [startDate, endDate] = splitDates(dateLine(e.lines));
        return { role: e.lines[0] ?? "", organization: before(subtitle(e.lines), "·"), startDate, endDate, bullets: bullets(e.details) };
    });
}

function publications(section: Element): Envelope["publications"] {
    return entries(section).map(e => {
        // "Journal of Examples · Jan 2020"
        const line = subtitle(e.lines);
        const [venue = "", date = ""] = line.split(/\s*·\s*/);
        return { title: e.lines[0] ?? "", venue, date: date || splitDates(dateLine(e.lines))[0], link: e.link };
    });
}

function languages(section: Element): Envelope["languages"] {
    return entries(section).map(e => ({ language: e.lines[0] ?? "", proficiency: e.lines[1] ?? "" }));
}

function custom(section: Element, heading: string): Envelope["custom"] {
    return entries(section).map(e => {
        const [startDate, endDate] = splitDates(dateLine(e.lines));
        return { section: heading, title: e.lines[0] ?? "", subtitle: before(subtitle(e.lines), "·"), startDate, endDate, bullets: bullets(e.details) };
    });
}

/** The About card's text, without its heading. */
function about(section: Element): string[] {
    const box = section.querySelector(SELECTORS.textBox);
    if (box) return [linesOf(box).join("\n")].filter(Boolean);
    const heading = section.querySelector("h2");
    return [pieces(section, heading).join("\n")].filter(Boolean);
}

const headingOf = (section: Element) => {
    const h2 = section.querySelector("h2");
    return h2 ? (linesOf(h2)[0] ?? "").replace(/\s*\(\d+\)$/, "") : "";
};

type Parser = (section: Element) => unknown[];
/** A parsed item the parser is sure about (its main field is there). */
type Check = (item: never) => boolean;

const PARSERS: Record<SectionId, { parse: Parser; ok: Check }> = {
    about: { parse: about, ok: (x: string) => x.length > 0 },
    experience: { parse: experience, ok: (x: Envelope["workExperience"][number]) => Boolean(x.title && (x.company || x.startDate)) },
    education: { parse: education, ok: (x: Envelope["education"][number]) => Boolean(x.institution) },
    skills: { parse: skills, ok: (x: Envelope["skills"][number]) => x.items.length > 0 },
    projects: { parse: projects, ok: (x: Envelope["projects"][number]) => Boolean(x.title) },
    licenses_and_certifications: { parse: certifications, ok: (x: Envelope["certifications"][number]) => Boolean(x.name) },
    honors_and_awards: { parse: awards, ok: (x: Envelope["awards"][number]) => Boolean(x.title) },
    volunteering_experience: { parse: volunteering, ok: (x: Envelope["volunteering"][number]) => Boolean(x.role) },
    publications: { parse: publications, ok: (x: Envelope["publications"][number]) => Boolean(x.title) },
    languages: { parse: languages, ok: (x: Envelope["languages"][number]) => Boolean(x.language) },
    organizations: { parse: s => custom(s, SECTIONS.organizations), ok: (x: Envelope["custom"][number]) => Boolean(x.title) },
    courses: { parse: s => custom(s, SECTIONS.courses), ok: (x: Envelope["custom"][number]) => Boolean(x.title) },
    patents: { parse: s => custom(s, SECTIONS.patents), ok: (x: Envelope["custom"][number]) => Boolean(x.title) },
    test_scores: { parse: s => custom(s, SECTIONS.test_scores), ok: (x: Envelope["custom"][number]) => Boolean(x.title) },
};

/** Runs a section parser over `scope` (a card, or a whole details page). */
function parseSection(id: SectionId, scope: Element): { items: unknown[]; bad: number } {
    const all = PARSERS[id].parse(scope);
    const ok = PARSERS[id].ok as (x: unknown) => boolean;
    const items = all.filter(ok);
    return { items, bad: all.length - items.length };
}

// ---------- Top card ----------

const PRONOUNS = /^\(?(she|he|they|ze|xe)\/\w+\)?$/i;
const NOISE = /^(\(?(she|he|they)\/|·|\d+(st|nd|rd|th)\b|contact info$|\d[\d,+]*\s+(connections|followers)$)/i;

/** Name, headline and location. */
function readTopCard(root: Element): ImportEnvelope["personalInfo"] {
    const card = outermost(root, SELECTORS.topCard)[0];
    if (card) {
        const nameEl = card.querySelector("h1, h2");
        const name = nameEl ? (linesOf(nameEl)[0] ?? "") : "";
        if (!name) return {};
        const noise = (el: Element) => el === nameEl || el.matches('a, [role="button"], [data-testid^="carousel"], ul, ol');
        const rest = linesOf(card, noise).filter(l => l !== name && !PRONOUNS.test(l) && !NOISE.test(l));
        const contact = card.querySelector(SELECTORS.contactInfo);
        // The location shares its row with the "Contact info" link.
        const row = contact?.closest("p")?.parentElement ?? contact?.parentElement ?? null;
        const location = (row && linesOf(row, el => el.matches("a")).find(l => l !== "·" && !NOISE.test(l)))
            || rest.slice(1).find(l => l.includes(",") && l.length <= 80) || "";
        const headline = rest.find(l => l !== location) ?? "";
        return { name, headline, location };
    }
    // Older markup: the card holding the <h1>.
    const h1 = root.querySelector("h1");
    const old = h1?.closest("section") ?? h1?.parentElement;
    if (!h1 || !old) return {};
    const name = textOf(h1);
    // The top card mixes plain text (headline, location) with aria-hidden pieces, so read every leaf.
    const rest = leaves(old).filter(p => p !== name && !NOISE.test(p));
    return { name, headline: rest[0] ?? "", location: rest.slice(1).find(p => p.includes(",") && p.length <= 80) ?? "" };
}

// ---------- Profile ----------

export function isLoginWall(doc: Document): boolean {
    return doc.querySelector(SELECTORS.loginWall) !== null;
}

const viewName = (id: SectionId) => `[data-view-name="profile-card-${id.replace(/_/g, "-")}"]`;

/** A section's card: by view name, else a profile card with its heading, else (old markup) its anchor id. */
function findSection(root: Element, id: SectionId): Element | null {
    const byView = outermost(root, viewName(id))[0];
    if (byView) return byView;
    const label = SECTIONS[id].toLowerCase();
    const byHeading = outermost(root, SELECTORS.anyCard).find(card => headingOf(card).toLowerCase() === label);
    if (byHeading) return byHeading;
    const anchor = root.querySelector(`[id="${id}"]`);
    const old = anchor?.closest("section") ?? null;
    return old && !old.closest("aside") ? old : null;
}

/** Same-profile /details/<section>/ URL for a link, or null (other profiles, other paths, other hosts). */
export function detailsUrl(href: string, profileUrl: string): string | null {
    let url: URL;
    try {
        url = new URL(href, `${profileUrl}/`);
    } catch {
        return null;
    }
    const m = /^\/in\/([^/]+)\/details\/([a-z][a-z-]{1,40})\/?$/.exec(url.pathname);
    if (!m || url.protocol !== "https:") return null;
    const profile = canonicalProfileUrl(`https://${url.host}/in/${m[1]}`);
    return profile !== null && profile === canonicalProfileUrl(profileUrl) ? `${profile}/details/${m[2]}/` : null;
}

/** The card's "Show all N" link to its full list, or null. Edit / add pencils and entry links are not it. */
function showAllUrl(section: Element, profileUrl: string | null): string | null {
    if (!profileUrl) return null;
    for (const a of Array.from(section.querySelectorAll('a[href*="/details/"]'))) {
        if (a.hasAttribute("data-view-name") || a.closest(`${SELECTORS.entry}, li`)) continue;
        if (/^(edit|add)\b/i.test(a.getAttribute("aria-label") ?? "")) continue;
        const url = detailsUrl(a.getAttribute("href") ?? "", profileUrl);
        if (url) return url;
    }
    return null;
}

/** What the page shows: a profile we know, something else with content, or not much yet. */
export function pageState(doc: Document): "login" | "ready" | "unrecognised" | "loading" {
    if (isLoginWall(doc)) return "login";
    const root = doc.querySelector(SELECTORS.main);
    if (!root) return "loading";
    if (outermost(root, SELECTORS.topCard).length > 0 || root.querySelector("h1")) return "ready";
    if (SECTION_IDS.some(id => findSection(root, id))) return "ready";
    const text = linesOf(root, el => el.matches("aside, nav")).join(" ");
    return text.length >= 300 && root.querySelector("h2") ? "unrecognised" : "loading";
}

/** The profile read from one page, before details pages and envelope assembly. */
interface Reading {
    personalInfo: NonNullable<ImportEnvelope["personalInfo"]>;
    parts: Partial<Record<SectionId, unknown[]>>;
    warnings: string[];
    unread: SectionId[];
    truncated: Partial<Record<SectionId, string>>;
}

function readProfile(doc: Document, profileUrl: string | null): Reading {
    const state = pageState(doc);
    if (state === "login") throw new CaptureError(CAPTURE_ERRORS.loginWall);
    if (state === "loading") throw new CaptureError(CAPTURE_ERRORS.notLoaded);
    const root = doc.querySelector(SELECTORS.main)!;
    const reading: Reading = { personalInfo: readTopCard(root) ?? {}, parts: {}, warnings: [], unread: [], truncated: {} };
    for (const id of SECTION_IDS) {
        const section = findSection(root, id);
        if (!section) continue;
        const label = SECTIONS[id];
        const more = showAllUrl(section, profileUrl);
        if (more) reading.truncated[id] = more;
        try {
            const { items, bad } = parseSection(id, section);
            if (items.length === 0 && (bad > 0 || hasEntries(section))) {
                reading.warnings.push(`Could not read ${label}.`);
                reading.unread.push(id);
            } else if (bad > 0) {
                reading.warnings.push(`Could not read part of ${label}.`);
                reading.unread.push(id);
            }
            reading.parts[id] = items;
        } catch {
            reading.warnings.push(`Could not read ${label}.`);
            reading.unread.push(id);
        }
    }
    return reading;
}

function assemble(r: Reading): CaptureResult {
    const data: ImportEnvelope = { personalInfo: { ...r.personalInfo } };
    const summary = (r.parts.about as string[] | undefined)?.[0];
    if (summary) data.personalInfo = { ...data.personalInfo, summary };
    const list = <T>(id: SectionId) => (r.parts[id] ?? []) as T[];
    data.workExperience = list("experience");
    data.education = list("education");
    data.skills = list("skills");
    data.projects = list("projects");
    data.certifications = list("licenses_and_certifications");
    data.awards = list("honors_and_awards");
    data.volunteering = list("volunteering_experience");
    data.publications = list("publications");
    data.languages = list("languages");
    data.custom = CUSTOM_SECTIONS.flatMap(id => list<Envelope["custom"][number]>(id));
    const warnings = [...r.warnings];
    for (const id of Object.keys(r.truncated) as SectionId[]) warnings.push(incompleteWarning(id));
    return {
        data, warnings,
        unread: [...new Set(r.unread.map(id => SECTION_KEY[id]))],
        topCard: Boolean(r.personalInfo.name),
    };
}

const incompleteWarning = (id: SectionId) => `${SECTIONS[id]} may be incomplete: LinkedIn shows only part of it on your profile page.`;

/**
 * The profile on `doc` as an ImportEnvelope, with warnings, the envelope keys it could not read and
 * whether the top card was read. Cards cut short ("Show all") are reported, not followed (see
 * captureProfile). Throws CaptureError for a login wall or a page that has not rendered yet.
 */
export function extractProfile(doc: Document, profileUrl: string | null = null): CaptureResult & { truncated: Partial<Record<SectionId, string>> } {
    const reading = readProfile(doc, profileUrl);
    return { ...assemble(reading), truncated: reading.truncated };
}

// ---------- Capture in the live tab ----------

const READY_TIMEOUT_MS = 8_000;
const SETTLE_TIMEOUT_MS = 4_000;
const POLL_MS = 250;
const realPause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export interface CaptureOptions {
    pause?: (ms: number) => Promise<void>;
}

/** "… more" controls inside recognised profile cards; nothing else on the page is ever clicked. */
function expanders(doc: Document): HTMLElement[] {
    const root = doc.querySelector(SELECTORS.main);
    if (!root) return [];
    return SECTION_IDS.flatMap(id => {
        const card = findSection(root, id);
        if (!card) return [];
        const current = Array.from(card.querySelectorAll<HTMLElement>(SELECTORS.expand));
        const old = Array.from(card.querySelectorAll<HTMLElement>(SELECTORS.seeMore)).filter(b => /^\s*…?\s*(see|show) more\b/i.test(b.textContent ?? ""));
        return [...current, ...old];
    }).filter(b => b.tagName === "BUTTON" && !b.closest("a, form") && !/\b(edit|add|connect|follow|message|remove|delete)\b/i.test(b.getAttribute("aria-label") ?? ""));
}

/** Scrolls the page so lazy cards render, opens "… more" in profile cards, then waits for the page to settle. */
async function loadWholeProfile(win: Window, pause: (ms: number) => Promise<void>) {
    const doc = win.document;
    const clicked = new WeakSet<Element>();
    const expand = () => expanders(doc).forEach(b => {
        if (clicked.has(b)) return;
        clicked.add(b);
        b.click();
    });
    for (let i = 0; i < 15; i++) {
        win.scrollBy(0, win.innerHeight);
        // The lazy column renders cards as they near the viewport.
        doc.querySelector('[data-testid="lazy-column"]')?.lastElementChild?.scrollIntoView?.({ block: "end" });
        await pause(POLL_MS);
        expand();
        if (win.scrollY + win.innerHeight >= (doc.documentElement?.scrollHeight ?? 0) - 2) break;
    }
    // Stable = the main column's text stops changing (bounded).
    const size = () => doc.querySelector(SELECTORS.main)?.textContent?.length ?? 0;
    let last = -1;
    for (let waited = 0; waited < SETTLE_TIMEOUT_MS; waited += POLL_MS) {
        expand();
        const now = size();
        if (now === last) break;
        last = now;
        await pause(POLL_MS);
    }
    win.scrollTo(0, 0);
}

/** Captures the profile open in `win`, which must be `expectedUrl` before and after. */
export async function captureProfile(expectedUrl: string, win: Window = window, opts: CaptureOptions = {}): Promise<CaptureResult> {
    const pause = opts.pause ?? realPause;
    const expected = canonicalProfileUrl(expectedUrl);
    const onProfile = () => expected !== null && canonicalProfileUrl(win.location.href) === expected;
    if (!onProfile() || !expected) throw new CaptureError(CAPTURE_ERRORS.mismatch);
    if (isLoginWall(win.document)) throw new CaptureError(CAPTURE_ERRORS.loginWall);
    for (let waited = 0; pageState(win.document) === "loading" && waited < READY_TIMEOUT_MS; waited += POLL_MS) await pause(POLL_MS);
    if (pageState(win.document) === "loading") throw new CaptureError(CAPTURE_ERRORS.notLoaded);
    await loadWholeProfile(win, pause);
    if (!onProfile()) throw new CaptureError(CAPTURE_ERRORS.mismatch);
    const reading = readProfile(win.document, expected);
    const result = assemble(reading);
    if (!onProfile()) throw new CaptureError(CAPTURE_ERRORS.mismatch);
    return result;
}
