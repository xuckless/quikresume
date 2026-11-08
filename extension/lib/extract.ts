// Job posting extraction from the live DOM. Order: site adapter -> schema.org JobPosting JSON-LD ->
// readable-text heuristic (only when the page clearly reads like a posting). Pure DOM: unit-tested
// with jsdom (extract.test.ts). Selectors drift; every adapter falls back to JSON-LD / readable text.

import type { Posting } from "./types";

const MAX_DESCRIPTION = 30_000;

const clean = (s: string | null | undefined) => (s ?? "").replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

function text(doc: Document, selectors: string[]): string {
    for (const sel of selectors) {
        const el = doc.querySelector<HTMLElement>(sel);
        const t = clean(el?.innerText ?? el?.textContent);
        if (t) return t;
    }
    return "";
}

/** innerText keeps line breaks between blocks; jsdom has no layout, so fall back to textContent per block. */
function blockText(el: Element | null): string {
    if (!el) return "";
    const it = (el as HTMLElement).innerText;
    if (typeof it === "string" && it.trim()) return clean(it).slice(0, MAX_DESCRIPTION);
    // jsdom path (and a guard for pages that inline <style> in the description, like Indeed): never read CSS as text.
    el = el.cloneNode(true) as Element;
    el.querySelectorAll("style,script,noscript,template").forEach(n => n.remove());
    const parts: string[] = [];
    el.querySelectorAll("h1,h2,h3,h4,p,li").forEach(n => { const t = clean(n.textContent); if (t) parts.push(n.tagName === "LI" ? `- ${t}` : t); });
    return clean(parts.length ? parts.join("\n") : el.textContent).slice(0, MAX_DESCRIPTION);
}

function htmlToText(html: string, doc: Document): string {
    const div = doc.createElement("div");
    div.innerHTML = html.replace(/<(br|\/p|\/li|\/h\d|\/div)>/gi, "$&\n").replace(/<li>/gi, "<li>- ");
    return clean(div.textContent).slice(0, MAX_DESCRIPTION);
}

// ---------- canonical posting URLs for list/search pages that show one job in a pane

export function postingUrl(href: string, doc?: Document): string {
    let u: URL;
    try { u = new URL(href); } catch { return href; }
    const host = u.hostname.replace(/^www\./, "");
    if (host.endsWith("linkedin.com")) {
        const id = u.searchParams.get("currentJobId") ?? /\/jobs\/view\/(\d+)/.exec(u.pathname)?.[1];
        if (id) return `https://www.linkedin.com/jobs/view/${id}/`;
    }
    if (/(^|\.)indeed\./.test(host)) {
        // The selected card carries the key when the URL doesn't (first result opened without a vjk).
        const jk = u.searchParams.get("vjk") ?? u.searchParams.get("jk") ?? doc?.querySelector(".vjs-highlight [data-jk]")?.getAttribute("data-jk");
        if (jk && /^[0-9a-f]{8,32}$/i.test(jk)) return `https://${u.hostname}/viewjob?jk=${jk}`;
    }
    if (/(^|\.)glassdoor\./.test(host)) {
        const jl = u.searchParams.get("jl") ?? /_JV_[^.]*?(\d+)\.htm/.exec(u.pathname)?.[1];
        if (jl) return `https://${u.hostname}/job-listing/j?jl=${jl}`;
    }
    return u.toString();
}

// ---------- JSON-LD

interface LdJob {
    title?: string;
    description?: string;
    hiringOrganization?: { name?: string } | string;
    jobLocation?: unknown;
    employmentType?: string | string[];
    jobLocationType?: string;
}

function findLdJob(node: unknown, depth = 0): LdJob | null {
    if (!node || typeof node !== "object" || depth > 5) return null;
    if (Array.isArray(node)) {
        for (const n of node) { const f = findLdJob(n, depth + 1); if (f) return f; }
        return null;
    }
    const o = node as Record<string, unknown>;
    const type = o["@type"];
    if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) return o as LdJob;
    if (o["@graph"]) return findLdJob(o["@graph"], depth + 1);
    return null;
}

function ldLocation(loc: unknown): string {
    const one = (l: unknown): string => {
        if (!l || typeof l !== "object") return typeof l === "string" ? l : "";
        const a = (l as { address?: unknown }).address;
        if (typeof a === "string") return a;
        if (a && typeof a === "object") {
            const x = a as Record<string, unknown>;
            const country = typeof x.addressCountry === "object" ? (x.addressCountry as { name?: string })?.name : x.addressCountry;
            return [x.addressLocality, x.addressRegion, country].filter(v => typeof v === "string" && v).join(", ");
        }
        return "";
    };
    const list = Array.isArray(loc) ? loc : [loc];
    return [...new Set(list.map(one).filter(Boolean))].slice(0, 3).join(" · ");
}

export function jsonLdPosting(doc: Document): Omit<Posting, "url" | "site"> | null {
    for (const s of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
        let data: unknown;
        try { data = JSON.parse(s.textContent ?? ""); } catch { continue; }
        const job = findLdJob(data);
        if (!job?.title) continue;
        const org = typeof job.hiringOrganization === "string" ? job.hiringOrganization : job.hiringOrganization?.name ?? "";
        const remote = job.jobLocationType === "TELECOMMUTE" ? "Remote" : "";
        return {
            title: clean(job.title),
            company: clean(org),
            location: [ldLocation(job.jobLocation), remote].filter(Boolean).join(" · "),
            employmentType: clean(Array.isArray(job.employmentType) ? job.employmentType.join(", ") : job.employmentType ?? "").replace(/_/g, " ").toLowerCase(),
            description: job.description ? htmlToText(job.description, doc) : "",
            method: "json-ld",
        };
    }
    return null;
}

// ---------- site adapters

interface Adapter {
    site: string;
    test: (host: string, path: string) => boolean;
    title: string[];
    company: string[];
    location: string[];
    description: string[];
}

const ADAPTERS: Adapter[] = [
    {
        site: "LinkedIn", test: (h, p) => h.endsWith("linkedin.com") && p.startsWith("/jobs"),
        title: [".job-details-jobs-unified-top-card__job-title h1", ".job-details-jobs-unified-top-card__job-title", ".jobs-unified-top-card__job-title", ".top-card-layout__title", "h1"],
        company: [".job-details-jobs-unified-top-card__company-name", ".jobs-unified-top-card__company-name", ".topcard__org-name-link"],
        location: [".job-details-jobs-unified-top-card__primary-description-container .tvm__text", ".job-details-jobs-unified-top-card__bullet", ".topcard__flavor--bullet"],
        description: ["#job-details", ".jobs-description__content", ".jobs-box__html-content", ".description__text"],
    },
    {
        site: "Indeed", test: h => /(^|\.)indeed\./.test(h),
        // Search pages show the posting in a right-hand pane (React Native web markup, 2026); /viewjob uses the
        // older jobsearch-* markup. No bare "h1": on search pages it is the search heading ("… jobs in Canada").
        title: ['[data-testid="vj-job-title"]', '[data-testid="vj-job-title-compact"]', '[data-testid="jobsearch-JobInfoHeader-title"]', ".jobsearch-JobInfoHeader-title"],
        company: ['[data-testid="company-info-metadata"] a[href*="/cmp/"]', '[data-testid="company-info-metadata"] a', '[data-testid="inlineHeader-companyName"]', '[data-company-name="true"]'],
        location: ['[data-testid="company-info-metadata"] > div > div:nth-child(2)', '[data-testid="inlineHeader-companyLocation"]', '[data-testid="job-location"]'],
        description: [".simple-job-description-html", "#jobDescriptionText", ".react-native-html-content"],
    },
    {
        site: "Glassdoor", test: h => /(^|\.)glassdoor\./.test(h),
        title: ['[data-test="job-title"]', '[id^="jd-job-title"]', "h1"],
        company: ['[data-test="employer-name"]', '[class*="EmployerProfile_employerName"]'],
        location: ['[data-test="location"]'],
        description: ['[class*="JobDetails_jobDescription"]', '[data-test="jobDescriptionContent"]', "#JobDescriptionContainer"],
    },
    {
        site: "Greenhouse", test: h => h.includes("greenhouse.io"),
        title: [".job__title h1", ".app-title", "h1"],
        company: [".company-name"],
        location: [".job__location", ".location"],
        description: [".job__description", "#content"],
    },
    {
        site: "Lever", test: h => h === "jobs.lever.co",
        title: [".posting-headline h2"],
        company: [],
        location: [".posting-categories .location", ".location"],
        description: ['[data-qa="job-description"]', ".posting-page .section-wrapper"],
    },
    {
        site: "Ashby", test: h => h === "jobs.ashbyhq.com",
        title: ["h1"],
        company: [],
        location: ['[class*="_location"]'],
        description: ['[class*="_descriptionText"]', '[class*="description"]'],
    },
    {
        site: "Workday", test: h => h.endsWith("myworkdayjobs.com"),
        title: ['[data-automation-id="jobPostingHeader"]'],
        company: [],
        location: ['[data-automation-id="locations"] dd', '[data-automation-id="locations"]'],
        description: ['[data-automation-id="jobPostingDescription"]'],
    },
    {
        site: "Wellfound", test: h => h === "wellfound.com",
        title: ["h1"],
        company: ['a[href^="/company/"] h2', 'a[href^="/company/"]'],
        location: [],
        description: ['[class*="description"]'],
    },
];

/** Company from the URL for ATS hosts that put it in the path or subdomain. */
function companyFromUrl(u: URL): string {
    const host = u.hostname;
    const first = u.pathname.split("/").filter(Boolean)[0] ?? "";
    const title = (s: string) => s.replace(/[-_]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    if (host === "jobs.lever.co" || host === "jobs.ashbyhq.com" || host.includes("greenhouse.io")) return first ? title(first) : "";
    if (host.endsWith("myworkdayjobs.com")) return title(host.split(".")[0] ?? "");
    return "";
}

const POSTING_WORDS = /\b(responsibilit|requirement|qualification|what you'?ll do|about the role|about you|experience with|we'?re looking for|benefits|job description)\w*/gi;

function readablePosting(doc: Document): Omit<Posting, "url" | "site"> | null {
    const title = text(doc, ["h1"]);
    if (!title || title.length > 140) return null;
    const root = doc.querySelector("main") ?? doc.querySelector("article") ?? doc.body;
    const body = blockText(root);
    const hits = new Set((body.match(POSTING_WORDS) ?? []).map(w => w.toLowerCase().slice(0, 8)));
    if (body.length < 600 || hits.size < 2) return null;
    return { title, company: "", location: "", employmentType: "", description: body, method: "readable" };
}

/** The posting on this page, or null when it doesn't look like one. */
export function extractPosting(doc: Document, href: string): Posting | null {
    let u: URL;
    try { u = new URL(href); } catch { return null; }
    const host = u.hostname.replace(/^www\./, "");
    const ld = jsonLdPosting(doc);
    const adapter = ADAPTERS.find(a => a.test(host, u.pathname));
    let result: Omit<Posting, "url" | "site"> | null = null;

    if (adapter) {
        const description = blockText(adapter.description.map(s => doc.querySelector(s)).find(Boolean) ?? null);
        const title = text(doc, adapter.title);
        if (title && description.length >= 200) {
            result = {
                title,
                company: text(doc, adapter.company) || ld?.company || companyFromUrl(u),
                location: text(doc, adapter.location) || ld?.location || "",
                employmentType: ld?.employmentType ?? "",
                description,
                method: "adapter",
            };
        }
    }
    if (!result && ld && ld.description.length >= 200) result = { ...ld, company: ld.company || companyFromUrl(u) };
    if (!result && !adapter) result = readablePosting(doc);
    if (!result) return null;
    return {
        ...result,
        title: result.title.slice(0, 160),
        company: (result.company.split("\n")[0] ?? "").slice(0, 120),
        location: (result.location.split("\n")[0] ?? "").slice(0, 120),
        url: postingUrl(href, doc),
        site: adapter?.site ?? host,
    };
}
