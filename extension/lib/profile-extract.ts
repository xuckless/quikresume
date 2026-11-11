// LinkedIn profile page -> ImportEnvelope (src/lib/import/envelope.ts), parsed from the DOM in the
// profile tab (entrypoints/linkedin-profile.content.ts). No AI: the app validates the result with the same
// lenient schema as file import and opens its review step.
//
// Markup assumptions (LinkedIn's signed-in profile, 2024-25; see profile-extract.test.ts fixtures):
//   - each card is a <section> holding an anchor <div id="experience|education|..."> and an <h2>;
//   - entries are the card's outermost <li>s; an entry's visible text sits in <span aria-hidden="true">
//     pieces (each duplicated by a visually-hidden span for screen readers, which we skip);
//   - an entry's own lines come first (title, subtitle "Company · Full-time", dates, location), its nested
//     <ul> holds the description and, for several roles at one company, one <li> per role;
//   - a card cut short on the profile page links to /details/<section>/ ("Show all N ...").
// Class names are not relied on. Each section parser fails on its own: a section it cannot read becomes
// a warning, never a failed import.

import type { ImportEnvelope } from "../../src/lib/import/envelope";
import { canonicalProfileUrl } from "../../src/lib/import/linkedin";

export const SELECTORS = {
    /** The page's main column. */
    main: 'main, [role="main"], .scaffold-layout__main',
    /** The member's name. */
    name: "h1",
    /** Logged-out pages: the sign-in form, LinkedIn's auth wall, the sign-in modal on public profiles. */
    loginWall: 'input[type="password"], form[action*="login"], .authwall, .authwall-join-form, .contextual-sign-in-modal',
    /** Visible text pieces (their visually-hidden twins are for screen readers). */
    piece: 'span[aria-hidden="true"]',
    /** Never text: controls, icons, images. */
    skip: "button, svg, img, script, style",
    /** "Show all N ..." links to the full list on a details page. */
    truncated: 'a[href*="/details/"]',
    /** Collapsed "…see more" text inside the profile. */
    seeMore: 'button[aria-expanded="false"]',
} as const;

/** Card anchor id -> label used in warnings. */
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
type SectionId = keyof typeof SECTIONS;
/** Recognised cards with no section of their own: imported as custom entries under their heading. */
const CUSTOM_SECTIONS: SectionId[] = ["organizations", "courses", "patents", "test_scores"];

export class CaptureError extends Error {}

export const CAPTURE_ERRORS = {
    mismatch: "This tab is not the LinkedIn profile saved in quikResume.",
    loginWall: "Sign in to LinkedIn and open your profile, then click Import.",
    notLoaded: "Your profile hasn't finished loading. Wait for it, then click Import.",
};

// ---------- Text pieces ----------

const clean = (s: string) => s.replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{2,}/g, "\n").trim();

/** Text of an element with <br> as a line break and controls left out. */
function textOf(el: Element): string {
    const copy = el.cloneNode(true) as Element;
    copy.querySelectorAll(SELECTORS.skip).forEach(x => x.remove());
    copy.querySelectorAll("br").forEach(br => br.replaceWith("\n"));
    return clean(copy.textContent ?? "");
}

/** Text of every innermost element under `root`, in order, consecutive duplicates dropped. */
function leaves(root: Element, inScope: (el: Element) => boolean = () => true): string[] {
    const texts = Array.from(root.querySelectorAll("*"))
        .filter(el => inScope(el) && !el.closest(SELECTORS.skip) && el.tagName !== "BR" && Array.from(el.children).every(c => c.tagName === "BR"))
        .map(textOf)
        .filter(Boolean);
    return texts.filter((t, i) => t !== texts[i - 1]);
}

/** The visible text pieces under `root`, in order, leaving out anything inside `exclude`. */
function pieces(root: Element, exclude: Element | null = null): string[] {
    const inScope = (el: Element) => !(exclude && exclude.contains(el)) && !el.closest(SELECTORS.skip);
    const found = Array.from(root.querySelectorAll(SELECTORS.piece)).filter(el => inScope(el) && !el.parentElement?.closest(SELECTORS.piece));
    // Without aria-hidden pieces (older or simpler markup), fall back to the innermost text elements.
    return found.length > 0 ? found.map(textOf).filter(Boolean) : leaves(root, inScope);
}

// ---------- Entries ----------

interface Entry {
    /** The entry's own lines: title, subtitle, dates, location... */
    lines: string[];
    /** Description and other lines from its nested list. */
    details: string[];
    /** Several roles under one company. */
    roles: Entry[];
    /** First off-LinkedIn link in the entry. */
    link: string;
}

const MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?";
const DATE = `(?:${MONTH}\\s+)?(?:19|20)\\d{2}`;
/** "Jan 2021 - Present · 3 yrs", "2015 - 2019", "Mar 2020", with an optional "Issued" in front. */
const DATE_LINE = new RegExp(`^(?:Issued\\s+)?${DATE}(?:\\s*[-–]\\s*(?:${DATE}|Present))?(?:\\s*·.*)?$`, "i");
export const isDateLine = (line: string) => DATE_LINE.test(line.trim());

/** "Jan 2021 - Present · 3 yrs 2 mos" -> ["Jan 2021", "Present"]; "2019" -> ["2019", ""]. */
export function splitDates(line: string): [string, string] {
    const range = (line.split("·")[0] ?? "").replace(/^Issued\s+/i, "").trim();
    const [start = "", end = ""] = range.split(/\s*[-–]\s*/);
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

/** A nested <li> that is a role of its own (has a title and a date line), not a description. */
const isRole = (lines: string[]) => lines.length >= 2 && lines.slice(1).some(isDateLine);

function readEntry(li: Element): Entry {
    const nested = li.querySelector("ul");
    const entry: Entry = { lines: pieces(li, nested), details: [], roles: [], link: externalLink(li) };
    if (!nested) return entry;
    for (const child of Array.from(nested.children).filter(el => el.tagName === "LI")) {
        const own = readEntry(child);
        if (isRole(own.lines)) entry.roles.push(own);
        else entry.details.push(...own.lines, ...own.details);
    }
    return entry;
}

/** The card's entries: its outermost list items. */
function entries(section: Element): Entry[] {
    return Array.from(section.querySelectorAll("li"))
        .filter(li => !li.parentElement?.closest("li"))
        .map(readEntry)
        .filter(e => e.lines.length > 0);
}

/** Description lines as bullets: split, unbulleted, without LinkedIn's "Skills: a · b" footer. */
function bullets(details: string[]): string[] {
    return details
        .flatMap(d => d.split("\n"))
        .map(l => l.replace(/^[-•*▪◦]\s*/, "").trim())
        .filter(l => l && !/^skills:/i.test(l) && !/…\s*see more$/i.test(l));
}

const before = (s: string, sep: string) => (s.split(sep)[0] ?? "").trim();
const dateLine = (lines: string[]) => lines.find(isDateLine) ?? "";
/** First line after the title that is not a date. */
const subtitle = (lines: string[]) => lines.slice(1).find(l => !isDateLine(l)) ?? "";

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
function about(section: Element): string {
    const heading = section.querySelector("h2");
    return pieces(section, heading).join("\n");
}

/** Name, headline and location from the card holding the <h1>. */
function topCard(root: Element): ImportEnvelope["personalInfo"] {
    const h1 = root.querySelector(SELECTORS.name);
    const card = h1?.closest("section") ?? h1?.parentElement;
    if (!h1 || !card) return {};
    const name = textOf(h1);
    // After the name: headline, then location; pronouns, degree badges, counts and links are noise.
    const noise = /^(\(?(she|he|they)\/|·|\d+(st|nd|rd)\b|contact info$|\d[\d,+]*\s+(connections|followers)$)/i;
    // The top card mixes plain text (headline, location) with aria-hidden pieces, so read every leaf.
    const rest = leaves(card).filter(p => p !== name && !noise.test(p));
    const headline = rest[0] ?? "";
    const location = rest.slice(1).find(p => p.includes(",") && p.length <= 80) ?? "";
    return { name, headline, location };
}

// ---------- Profile ----------

export function isLoginWall(doc: Document): boolean {
    return doc.querySelector(SELECTORS.loginWall) !== null;
}

function sectionById(root: Element, id: SectionId): Element | null {
    const anchor = root.querySelector(`[id="${id}"]`);
    return anchor ? anchor.closest("section") : null;
}

const headingOf = (section: Element, id: SectionId) => {
    const h2 = section.querySelector("h2");
    return (h2 && pieces(h2)[0]) || SECTIONS[id];
};

/** The profile as an ImportEnvelope plus warnings for sections that were unreadable or cut short. */
export function extractProfile(doc: Document): { data: ImportEnvelope; warnings: string[] } {
    if (isLoginWall(doc)) throw new CaptureError(CAPTURE_ERRORS.loginWall);
    const root = doc.querySelector(SELECTORS.main);
    if (!root?.querySelector(SELECTORS.name)) throw new CaptureError(CAPTURE_ERRORS.notLoaded);

    const warnings: string[] = [];
    const data: ImportEnvelope = { personalInfo: topCard(root) };

    /** Runs one section parser; a failure or an empty result becomes a warning. */
    const read = <T>(id: SectionId, parse: (section: Element) => T[]): T[] => {
        const section = sectionById(root, id);
        if (!section) return [];
        const label = SECTIONS[id];
        if (section.querySelector(SELECTORS.truncated)) warnings.push(`${label} may be incomplete: LinkedIn shows only part of it on your profile page.`);
        try {
            const items = parse(section);
            if (items.length === 0 && section.querySelector("li")) warnings.push(`Could not read ${label}.`);
            return items;
        } catch {
            warnings.push(`Could not read ${label}.`);
            return [];
        }
    };

    const aboutText = read("about", s => [about(s)]).find(Boolean);
    if (aboutText) data.personalInfo = { ...data.personalInfo, summary: aboutText };
    data.workExperience = read("experience", experience);
    data.education = read("education", education);
    data.skills = read("skills", skills);
    data.projects = read("projects", projects);
    data.certifications = read("licenses_and_certifications", certifications);
    data.awards = read("honors_and_awards", awards);
    data.volunteering = read("volunteering_experience", volunteering);
    data.publications = read("publications", publications);
    data.languages = read("languages", languages);
    data.custom = CUSTOM_SECTIONS.flatMap(id => read(id, s => custom(s, headingOf(s, id))));
    return { data, warnings };
}

// ---------- Capture in the live tab ----------

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Scrolls through the page so lazy cards render, and opens "…see more" in the profile's own text. */
async function loadWholeProfile(win: Window) {
    for (let i = 0; i < 12; i++) {
        win.scrollBy(0, win.innerHeight);
        await pause(200);
        win.document.querySelector(SELECTORS.main)?.querySelectorAll<HTMLButtonElement>(SELECTORS.seeMore).forEach(button => {
            if (/see more|show more/i.test(button.textContent ?? "") && !button.closest("aside")) button.click();
        });
    }
    win.scrollTo(0, 0);
}

/** Captures the profile open in `win`, which must be `expectedUrl` before and after. */
export async function captureProfile(expectedUrl: string, win: Window = window): Promise<{ data: ImportEnvelope; warnings: string[] }> {
    const expected = canonicalProfileUrl(expectedUrl);
    const onProfile = () => expected !== null && canonicalProfileUrl(win.location.href) === expected;
    if (!onProfile()) throw new CaptureError(CAPTURE_ERRORS.mismatch);
    if (isLoginWall(win.document)) throw new CaptureError(CAPTURE_ERRORS.loginWall);
    await loadWholeProfile(win);
    const result = extractProfile(win.document);
    if (!onProfile()) throw new CaptureError(CAPTURE_ERRORS.mismatch);
    return result;
}
