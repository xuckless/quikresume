import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CAPTURE_ERRORS, captureProfile, detailsUrl, extractProfile, isDateLine, isLoginWall, pageState, splitDates } from "./profile-extract";
import { needsAnalysis } from "./profile-merge";

// ---------- Older markup (2024-25), hand-built ----------
// Cards are <section>s with an anchor <div id>, entries are <li>s whose visible text is in aria-hidden
// spans, each followed by a visually-hidden twin for screen readers. Still read as a fallback (and
// possibly the shape of /details/ pages); the current markup is tested on the live fixture below.
const t = (text: string) => `<span aria-hidden="true">${text}</span><span class="visually-hidden">${text}</span>`;
const entry = (lines: string[], sub = "", link = "") => `
  <li class="artdeco-list__item"><div data-view-name="profile-component-entity">
    <a href="/company/123/"><img alt="logo"></a>
    <div><div class="x1a2b"><div class="t-bold">${t(lines[0] ?? "")}</div>${lines.slice(1).map(l => `<span class="t-14">${t(l)}</span>`).join("")}</div>
    ${link ? `<a href="${link}">${t("Show project")}</a>` : ""}
    ${sub ? `<div class="pvs-list__outer-container"><ul>${sub}</ul></div>` : ""}</div>
  </div></li>`;
const desc = (html: string) => `<li><div class="inline-show-more-text">${t(html)}<button aria-expanded="true">…see less</button></div></li>`;
const card = (id: string, heading: string, items: string, more = "") => `
  <section class="artdeco-card"><div id="${id}" class="pv-profile-card__anchor"></div>
    <div class="pvs-header"><h2>${t(heading)}</h2></div><div><ul>${items}</ul></div>
    ${more ? `<div class="pvs-list__footer"><a href="/in/jane-person/details/${id}/">${t(more)}</a></div>` : ""}
  </section>`;

const TOP = `
  <section class="artdeco-card"><div><h1 class="text-heading-xlarge">Jane Person</h1><span>${t("She/Her")}</span><span>${t("· 1st")}</span></div>
    <div class="text-body-medium">Senior Engineer at Example | Payments</div>
    <div><span class="text-body-small">Toronto, Ontario, Canada</span><span>·</span><a href="/in/jane-person/overlay/contact-info/">Contact info</a></div>
    <ul><li><span>500+ connections</span></li></ul><button>Message</button></section>`;

const PROFILE = `
<header><nav>Home My Network Jobs Messaging</nav></header>
<main class="scaffold-layout__main">${TOP}
  ${card("about", "About", "")}
  ${card("experience", "Experience",
        entry(["Senior Engineer", "Example Inc · Full-time", "Jan 2021 - Present · 3 yrs 2 mos", "Toronto, Ontario, Canada · Hybrid"],
            desc("• Led the payments rewrite.<br>• Cut checkout latency by 40%.") + desc("Skills: React · Node.js"))
        + entry(["Globex", "Full-time · 5 yrs"],
            entry(["Team Lead", "Mar 2018 - Dec 2020 · 2 yrs 10 mos"], desc("Ran a team of six."))
            + entry(["Developer", "Jan 2016 - Feb 2018 · 2 yrs 2 mos"])),
        "Show all 6 experiences")}
  ${card("education", "Education", entry(["University of Toronto", "BSc, Computer Science", "2011 - 2015", "Grade: 3.8"], desc("Dean's list.")))}
  ${card("skills", "Skills", entry(["TypeScript"], desc("Endorsed by 3 colleagues")) + entry(["PostgreSQL"]), "Show all 42 skills")}
  ${card("projects", "Projects", entry(["Ledger CLI", "Jun 2022 - Aug 2022"], desc("A double-entry ledger in Rust."), "https://github.com/jane/ledger"))}
  ${card("licenses_and_certifications", "Licenses & certifications", entry(["AWS Certified Developer", "Amazon Web Services (AWS)", "Issued Jan 2022 · Expires Jan 2025", "Credential ID ABC-123"]))}
  ${card("honors_and_awards", "Honors & awards", entry(["Hackathon winner", "Issued by Example Foundation · Nov 2019"], desc("Associated with University of Toronto") + desc("First of 80 teams.")))}
  ${card("volunteering_experience", "Volunteering", entry(["Mentor", "Code Club", "Sep 2019 - Present · 5 yrs", "Education"], desc("Weekly coding sessions.")))}
  ${card("publications", "Publications", entry(["Fast ledgers", "Journal of Examples · Mar 2020"], "", "https://doi.org/10.1/abc"))}
  ${card("languages", "Languages", entry(["English", "Native or bilingual proficiency"]) + entry(["French", "Professional working proficiency"]))}
  ${card("courses", "Courses", entry(["Distributed Systems", "CS 454"]))}
  <section class="artdeco-card"><h2>${t("People also viewed")}</h2><ul>${entry(["John Other", "Engineer"])}</ul></section>
</main>
<aside><section><div id="experience"></div><ul>${entry(["Messaging overlay"])}</ul></section></aside>`;

const ABOUT = `<section class="artdeco-card"><div id="about"></div><div><h2>${t("About")}</h2></div>
  <div class="inline-show-more-text">${t("I build payment systems.<br>Based in Toronto.")}</div></section>`;

const JANE = "https://www.linkedin.com/in/jane-person";

function load(html = PROFILE) {
    document.body.innerHTML = html.replace(card("about", "About", ""), ABOUT);
    return extractProfile(document, JANE);
}

afterEach(() => { document.body.innerHTML = ""; });

describe("dates", () => {
    it.each([
        ["Jan 2021 - Present · 3 yrs 2 mos", ["Jan 2021", "Present"]],
        ["2011 - 2015", ["2011", "2015"]],
        ["Mar 2020", ["Mar 2020", ""]],
        ["Issued Jan 2022 · Expires Jan 2025", ["Jan 2022", ""]],
    ])("splits %s", (line, expected) => {
        expect(isDateLine(line)).toBe(true);
        expect(splitDates(line)).toEqual(expected);
    });
    it("does not take titles or descriptions for dates", () => {
        for (const line of ["Senior Engineer", "Example Inc · Full-time", "Led the 2021 migration", "Toronto, Ontario, Canada"]) expect(isDateLine(line)).toBe(false);
    });
});

describe("extractProfile (older markup)", () => {
    it("reads the top card and About", () => {
        const { data } = load();
        expect(data.personalInfo).toEqual({
            name: "Jane Person", headline: "Senior Engineer at Example | Payments", location: "Toronto, Ontario, Canada",
            summary: "I build payment systems.\nBased in Toronto.",
        });
    });

    it("reads a single role with Present, bullets, and drops the Skills footer", () => {
        expect(load().data.workExperience?.[0]).toEqual({
            title: "Senior Engineer", company: "Example Inc", startDate: "Jan 2021", endDate: "Present",
            bullets: ["Led the payments rewrite.", "Cut checkout latency by 40%."],
        });
    });

    it("splits several roles at one company into one entry each", () => {
        expect(load().data.workExperience?.slice(1)).toEqual([
            { title: "Team Lead", company: "Globex", startDate: "Mar 2018", endDate: "Dec 2020", bullets: ["Ran a team of six."] },
            { title: "Developer", company: "Globex", startDate: "Jan 2016", endDate: "Feb 2018", bullets: [] },
        ]);
    });

    it("reads education with year-only dates and a grade", () => {
        expect(load().data.education).toEqual([{
            degree: "BSc, Computer Science", institution: "University of Toronto", startDate: "2011", endDate: "2015", gpa: "3.8", details: "Dean's list.",
        }]);
    });

    it("reads skills, projects, certifications, awards, volunteering, publications, languages and other cards", () => {
        const { data } = load();
        expect(data.skills).toEqual([{ category: "Skills", items: ["TypeScript", "PostgreSQL"] }]);
        expect(data.projects).toEqual([{ title: "Ledger CLI", link: "https://github.com/jane/ledger", startDate: "Jun 2022", endDate: "Aug 2022", bullets: ["A double-entry ledger in Rust."] }]);
        expect(data.certifications).toEqual([{ name: "AWS Certified Developer", issuer: "Amazon Web Services (AWS)", year: "Jan 2022", credentialId: "ABC-123", expires: "Jan 2025" }]);
        expect(data.awards).toEqual([{ title: "Hackathon winner", issuer: "Example Foundation", date: "Nov 2019", description: "First of 80 teams." }]);
        expect(data.volunteering).toEqual([{ role: "Mentor", organization: "Code Club", startDate: "Sep 2019", endDate: "Present", bullets: ["Weekly coding sessions."] }]);
        expect(data.publications).toEqual([{ title: "Fast ledgers", venue: "Journal of Examples", date: "Mar 2020", link: "https://doi.org/10.1/abc" }]);
        expect(data.languages).toEqual([{ language: "English", proficiency: "Native or bilingual proficiency" }, { language: "French", proficiency: "Professional working proficiency" }]);
        expect(data.custom).toEqual([{ section: "Courses", title: "Distributed Systems", subtitle: "CS 454", startDate: "", endDate: "", bullets: [] }]);
    });

    it("ignores recommendations, navigation and the messaging overlay", () => {
        const json = JSON.stringify(load().data);
        expect(json).not.toMatch(/John Other|Home My Network|Messaging overlay|Show all|see less/);
    });

    it("reports cards cut short on the profile page", () => {
        const { warnings, truncated } = load();
        expect(truncated).toEqual({ experience: `${JANE}/details/experience/`, skills: `${JANE}/details/skills/` });
        expect(warnings).toEqual([
            "Experience may be incomplete: LinkedIn shows only part of it on your profile page.",
            "Skills may be incomplete: LinkedIn shows only part of it on your profile page.",
        ]);
    });

    it("turns an unreadable card into a warning and keeps the rest", () => {
        const html = PROFILE.replace(/<section class="artdeco-card"><div id="projects"[\s\S]*?<\/section>/, `<section><div id="projects"></div><h2>${t("Projects")}</h2><ul><li><div></div></li></ul></section>`);
        const { data, warnings } = load(html);
        expect(data.projects).toEqual([]);
        expect(warnings).toContain("Could not read Projects.");
        expect(data.workExperience).toHaveLength(3);
        expect(load(html).unread).toEqual(["projects"]);
    });

    it("needs the name to have rendered", () => {
        document.body.innerHTML = "<main><p>Loading…</p></main>";
        expect(() => extractProfile(document)).toThrow(CAPTURE_ERRORS.notLoaded);
    });
});

describe("isLoginWall", () => {
    it.each([
        '<main><h1>Sign in</h1><form action="/uas/login-submit"><input type="password"></form></main>',
        '<div class="authwall"><h1>Join LinkedIn</h1></div>',
        '<main><section><h1>Jane Person</h1></section></main><div class="contextual-sign-in-modal"></div>',
    ])("detects %s", html => {
        document.body.innerHTML = html;
        expect(isLoginWall(document)).toBe(true);
        expect(() => extractProfile(document)).toThrow(CAPTURE_ERRORS.loginWall);
    });

    it("is false on a signed-in profile", () => {
        document.body.innerHTML = PROFILE;
        expect(isLoginWall(document)).toBe(false);
    });
});


// ---------- Current markup: anonymised copy of a saved live profile (2026-11) ----------

const LIVE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "__fixtures__/linkedin-profile-2026.html"), "utf8");
const JORDAN = "https://www.linkedin.com/in/jordan-example";

function live(edit?: (doc: Document) => void) {
    document.body.innerHTML = LIVE;
    edit?.(document);
    return extractProfile(document, JORDAN);
}
/** Empties every entry of a card (a card whose markup the parser no longer understands). */
const breakCard = (view: string) => (doc: Document) =>
    doc.querySelectorAll(`[data-view-name="${view}"] [componentkey^="entity-collection-item"]`).forEach(el => { el.innerHTML = "<div><div></div></div>"; });

describe("extractProfile (current markup)", () => {
    it("reads the top card from its h2 and the About text", () => {
        const { data, topCard } = live();
        expect(topCard).toBe(true);
        expect(data.personalInfo).toMatchObject({ name: "Jordan Example", headline: "Student at Northfield University.", location: "Lakeview, Ontario, Canada" });
        expect(data.personalInfo?.summary).toMatch(/^Materials updated orders/);
        expect(data.personalInfo?.summary).not.toMatch(/more$/);
    });

    it("reads every experience entry: title, company without employment type, both date forms, bullets", () => {
        const jobs = live().data.workExperience ?? [];
        expect(jobs.map(({ bullets: _, ...rest }) => rest)).toEqual([
            { title: "Campus Outreach Assistant", company: "Northfield University", startDate: "Mar 2021", endDate: "Present" },
            { title: "Field Service Technician", company: "Acme Field Services", startDate: "Jun 2022", endDate: "Sep 2023" },
            { title: "Site Operator: Kiosk Repair Technician", company: "Globex Repair", startDate: "Sep 2022", endDate: "Dec 2022" },
            { title: "Client Service Associate", company: "Initech Tax Services", startDate: "Jan 2021", endDate: "May 2021" },
            { title: "Freelance Editor", company: "Self-employed", startDate: "2018", endDate: "Dec 2019" },
        ]);
        expect(jobs.map(j => j.bullets.length)).toEqual([6, 4, 3, 3, 3]);
        expect(jobs[0]?.bullets[0]).toBe("Outreach Assistant, Office of Admissions - Northfield University");
        // "•" stripped; no "… more", no "X, Y and +N skills", no location or "Present" marker in descriptions.
        for (const b of jobs.flatMap(j => j.bullets)) expect(b).not.toMatch(/^•|…|more$|\+\d+ skills?|On-site|^Present$/);
    });

    it("splits several roles at one company (nested list items with their own dates) into one entry each", () => {
        // Not in the saved page: the grouped shape is assumed from the single-role markup.
        const role = (title: string, dates: string, text: string) =>
            `<div role="listitem"><p>${title}</p><p>${dates}</p><p><span data-testid="expandable-text-box">• ${text}<br>• More ${text}</span></p></div>`;
        const result = live(doc => {
            const first = doc.querySelector('[data-view-name="profile-card-experience"] [componentkey^="entity-collection-item"]')!;
            first.innerHTML = `<div><a href="https://www.linkedin.com/company/1/"><p>Globex</p></a><p>Full-time · 5 yrs</p><div role="list">${
                role("Team Lead", "Mar 2018 - Dec 2020 · 2 yrs 10 mos", "Ran a team") + role("Developer", "2016 – Feb 2018", "Wrote code")}</div></div>`;
        });
        expect(result.data.workExperience?.slice(0, 2)).toEqual([
            { title: "Team Lead", company: "Globex", startDate: "Mar 2018", endDate: "Dec 2020", bullets: ["Ran a team", "More Ran a team"] },
            { title: "Developer", company: "Globex", startDate: "2016", endDate: "Feb 2018", bullets: ["Wrote code", "More Wrote code"] },
        ]);
    });

    it("reads education, certifications, volunteering and the visible skills", () => {
        const { data } = live();
        expect(data.education).toEqual([{
            degree: "Bachelor of Science (BSc) - Computer Science, Business Administration", institution: "Northfield University",
            startDate: "Sep 2020", endDate: "Jul 2024", gpa: "3.7/4", details: "",
        }]);
        expect(data.certifications).toEqual([{ name: "Field Safety Licence", issuer: "OSHB", year: "Sep 2025", credentialId: "FS-100-2000300", expires: "Sep 2030" }]);
        expect(data.volunteering).toEqual([expect.objectContaining({ role: "Outreach Coordinator", organization: "Students Helping Students (SHS)", startDate: "Oct 2020", endDate: "Dec 2021" })]);
        expect(data.volunteering?.[0]?.bullets).toHaveLength(3);
        expect(data.skills).toEqual([{ category: "Skills", items: ["Customer Service", "Data Entry"] }]);
    });

    it("is confident, and reports the Skills card as cut short (its Show all link, not the edit pencils)", () => {
        const result = live();
        expect(result.unread).toEqual([]);
        expect(needsAnalysis(result)).toBe(false);
        expect(result.truncated).toEqual({ skills: `${JORDAN}/details/skills/` });
        expect(result.warnings).toEqual(["Skills may be incomplete: LinkedIn shows only part of it on your profile page."]);
    });

    it("ignores LinkedIn's own cards and the recommendations aside", () => {
        const json = JSON.stringify(live().data);
        expect(json).not.toMatch(/Dashboard|profile views|followers|Following|Connected apps|Connect\b|Show all|Interests/);
    });

    it("marks a recognised card it cannot read as unread, so the AI fallback runs", () => {
        const result = live(breakCard("profile-card-experience"));
        expect(result.data.workExperience).toEqual([]);
        expect(result.unread).toEqual(["workExperience"]);
        expect(result.warnings).toContain("Could not read Experience.");
        expect(result.data.education).toHaveLength(1);
        expect(needsAnalysis(result)).toBe(true);
    });

    it("tells a page still loading from a layout it does not recognise", () => {
        document.body.innerHTML = '<main><div data-testid="lazy-column"><div></div></div></main>';
        expect(pageState(document)).toBe("loading");
        expect(() => extractProfile(document)).toThrow(CAPTURE_ERRORS.notLoaded);

        document.body.innerHTML = LIVE;
        document.querySelectorAll("[data-view-name]").forEach(el => el.removeAttribute("data-view-name"));
        expect(pageState(document)).toBe("unrecognised");
        const result = extractProfile(document, JORDAN);
        expect(result).toMatchObject({ topCard: false, unread: [] });
        expect(result.data.workExperience).toEqual([]);
        expect(needsAnalysis(result)).toBe(true);
    });
});

describe("detailsUrl", () => {
    it.each([
        ["https://www.linkedin.com/in/jordan-example/details/skills/", `${JORDAN}/details/skills/`],
        ["/in/Jordan-Example/details/experience?x=1", `${JORDAN}/details/experience/`],
        ["https://linkedin.com/in/jordan-example/details/certifications", `${JORDAN}/details/certifications/`],
    ])("accepts the profile's own %s", (href, expected) => expect(detailsUrl(href, JORDAN)).toBe(expected));

    it.each([
        "https://www.linkedin.com/in/someone-else/details/skills/",
        "https://www.linkedin.com/in/jordan-example/details/education/edit/forms/123/",
        "https://evil.example/in/jordan-example/details/skills/",
        "http://www.linkedin.com/in/jordan-example/details/skills/",
        "https://www.linkedin.com/in/jordan-example/overlay/contact-info/",
    ])("refuses %s", href => expect(detailsUrl(href, JORDAN)).toBeNull());
});

describe("captureProfile", () => {
    const fakeWindow = (href: string) => ({ location: { href }, document, innerHeight: 800, scrollY: 0, scrollBy: () => {}, scrollTo: () => {} }) as unknown as Window;
    const opts = (fetchPage = vi.fn(async () => null as Document | null)) => ({ pause: async () => {}, fetchPage });
    afterEach(() => { vi.restoreAllMocks(); });

    it("refuses a tab that is not the expected profile, before reading anything", async () => {
        document.body.innerHTML = PROFILE;
        await expect(captureProfile(JANE, fakeWindow("https://www.linkedin.com/in/someone-else"), opts())).rejects.toThrow(CAPTURE_ERRORS.mismatch);
        await expect(captureProfile(JANE, fakeWindow(`${JANE}/details/experience/`), opts())).rejects.toThrow(CAPTURE_ERRORS.mismatch);
    });

    it("refuses a login wall on the right URL", async () => {
        document.body.innerHTML = '<div class="authwall"></div>';
        await expect(captureProfile(JANE, fakeWindow(JANE), opts())).rejects.toThrow(CAPTURE_ERRORS.loginWall);
    });

    it("opens only the '… more' controls inside profile cards", async () => {
        document.body.innerHTML = LIVE;
        const clicked: Element[] = [];
        vi.spyOn(HTMLElement.prototype, "click").mockImplementation(function (this: HTMLElement) { clicked.push(this); });
        await captureProfile(JORDAN, fakeWindow(JORDAN), opts());
        expect(clicked).toHaveLength(5);
        for (const el of clicked) {
            expect(el.getAttribute("data-testid")).toBe("expandable-text-button");
            expect(el.closest('[data-view-name^="profile-card-"]')).not.toBeNull();
        }
    });

    it("completes a cut-short card from its details page and drops the warning", async () => {
        document.body.innerHTML = LIVE;
        const item = (name: string) => `<div componentkey="entity-collection-item-${name.length}"><div><p><span>${name}</span></p><div role="list"><div role="listitem"><p><span>Used at Example</span></p></div></div></div></div>`;
        const details = new DOMParser().parseFromString(`<main><section><h2>Skills</h2>${["Customer Service", "Data Entry", "Scheduling", "Bookkeeping"].map(item).join("")}</section></main>`, "text/html");
        const fetchPage = vi.fn(async () => details);
        const capture = await captureProfile(JORDAN, fakeWindow(JORDAN), opts(fetchPage));
        expect(fetchPage).toHaveBeenCalledExactlyOnceWith(`${JORDAN}/details/skills/`);
        expect(capture.data.skills).toEqual([{ category: "Skills", items: ["Customer Service", "Data Entry", "Scheduling", "Bookkeeping"] }]);
        expect(capture.warnings).toEqual([]);
    });

    it("keeps the visible items with a warning when the details page has nothing readable", async () => {
        document.body.innerHTML = LIVE;
        const empty = new DOMParser().parseFromString("<main><div id=root></div></main>", "text/html");
        const capture = await captureProfile(JORDAN, fakeWindow(JORDAN), opts(vi.fn(async () => empty)));
        expect(capture.data.skills?.[0]?.items).toEqual(["Customer Service", "Data Entry"]);
        expect(capture.warnings).toEqual(["Skills may be incomplete: LinkedIn shows only part of it on your profile page."]);
    });
});
