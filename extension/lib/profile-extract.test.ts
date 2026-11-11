import { afterEach, describe, expect, it } from "vitest";
import { CAPTURE_ERRORS, captureProfile, extractProfile, isDateLine, isLoginWall, splitDates } from "./profile-extract";

// Minimal fixtures in the shape of LinkedIn's signed-in profile (2024-25): cards are <section>s with an
// anchor <div id>, entries are <li>s whose visible text is in aria-hidden spans, each followed by a
// visually-hidden twin for screen readers. Not captured from the live site; see the module header.
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

function load(html = PROFILE) {
    document.body.innerHTML = html.replace(card("about", "About", ""), ABOUT);
    return extractProfile(document);
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

describe("extractProfile", () => {
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

    it("warns about cards cut short on the profile page", () => {
        const { warnings } = load();
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

describe("captureProfile", () => {
    const URL_ = "https://www.linkedin.com/in/jane-person";
    const fakeWindow = (href: string) => ({ location: { href }, document, innerHeight: 800, scrollBy: () => {}, scrollTo: () => {} }) as unknown as Window;

    it("refuses a tab that is not the expected profile, before reading anything", async () => {
        document.body.innerHTML = PROFILE;
        await expect(captureProfile(URL_, fakeWindow("https://www.linkedin.com/in/someone-else"))).rejects.toThrow(CAPTURE_ERRORS.mismatch);
        await expect(captureProfile(URL_, fakeWindow(`${URL_}/details/experience/`))).rejects.toThrow(CAPTURE_ERRORS.mismatch);
    });

    it("refuses a login wall on the right URL", async () => {
        document.body.innerHTML = '<div class="authwall"></div>';
        await expect(captureProfile(URL_, fakeWindow(URL_))).rejects.toThrow(CAPTURE_ERRORS.loginWall);
    });
});
