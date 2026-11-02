import { describe, expect, it } from "vitest";
import { extractPosting, postingUrl } from "./extract";

const body = "<p>About the role</p><p>We're looking for a nurse.</p><ul><li>Responsibilities: patient care across a 30-bed unit and coordination with physicians</li><li>Requirements: active RN licence, BLS certification, two years of acute care experience</li></ul>".repeat(3);

function doc(html: string) {
    return new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, "text/html");
}

describe("extractPosting", () => {
    it("reads schema.org JobPosting JSON-LD", () => {
        const ld = { "@context": "https://schema.org", "@type": "JobPosting", title: "Registered Nurse", description: body, hiringOrganization: { name: "St. Mary's" },
            jobLocation: { address: { addressLocality: "Toronto", addressRegion: "ON", addressCountry: "CA" } }, employmentType: "FULL_TIME" };
        const p = extractPosting(doc(`<h1>x</h1><script type="application/ld+json">${JSON.stringify(ld)}</script>`), "https://careers.example.com/jobs/42?utm_source=x");
        expect(p).toMatchObject({ title: "Registered Nurse", company: "St. Mary's", location: "Toronto, ON, CA", employmentType: "full time", method: "json-ld" });
        expect(p!.description).toContain("- Requirements: active RN licence");
    });
    it("finds JobPosting inside @graph", () => {
        const ld = { "@graph": [{ "@type": "Organization" }, { "@type": ["JobPosting"], title: "Electrician", description: body }] };
        expect(extractPosting(doc(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`), "https://x.com/j")?.title).toBe("Electrician");
    });
    it("uses a site adapter on Lever and takes the company from the path", () => {
        const p = extractPosting(doc(`<div class="posting-headline"><h2>Account Executive</h2></div><div class="posting-categories"><div class="location">Remote</div></div><div data-qa="job-description">${body}</div>`), "https://jobs.lever.co/acme-corp/123");
        expect(p).toMatchObject({ title: "Account Executive", company: "Acme Corp", location: "Remote", method: "adapter", site: "Lever" });
    });
    it("falls back to readable text only when the page reads like a posting", () => {
        expect(extractPosting(doc(`<main><h1>Teacher, Grade 4</h1>${body}</main>`), "https://district.example.org/careers/9")?.method).toBe("readable");
        expect(extractPosting(doc(`<main><h1>Our blog</h1><p>${"Lorem ipsum ".repeat(200)}</p></main>`), "https://example.org/blog")).toBeNull();
    });
});

describe("postingUrl", () => {
    it("turns list panes into the posting's own URL", () => {
        expect(postingUrl("https://www.linkedin.com/jobs/search/?currentJobId=3912&keywords=nurse")).toBe("https://www.linkedin.com/jobs/view/3912/");
        expect(postingUrl("https://ca.indeed.com/jobs?q=x&vjk=abc123")).toBe("https://ca.indeed.com/viewjob?jk=abc123");
    });
});
