import { describe, expect, it } from "vitest";
import { canonicalJobUrl, jobUrlKey } from "@/lib/jobs/canonical-url";

describe("canonicalJobUrl", () => {
    it("drops tracking params, fragment, www and trailing slash; keeps identity params sorted", () => {
        expect(canonicalJobUrl("https://www.LinkedIn.com/jobs/view/123/?trk=abc&utm_source=x&refId=9#top"))
            .toBe("https://linkedin.com/jobs/view/123");
        expect(canonicalJobUrl("https://boards.greenhouse.io/acme/jobs/55?gh_src=feed&gh_jid=55"))
            .toBe("https://boards.greenhouse.io/acme/jobs/55?gh_jid=55");
        expect(canonicalJobUrl("https://acme.wd5.myworkdayjobs.com/x?source=LinkedIn&jobId=7&a=1"))
            .toBe("https://acme.wd5.myworkdayjobs.com/x?a=1&jobId=7");
    });
    it("rejects non-http URLs", () => {
        expect(canonicalJobUrl("javascript:alert(1)")).toBeNull();
        expect(canonicalJobUrl("not a url")).toBeNull();
    });
    it("same posting, same key", () => {
        const a = canonicalJobUrl("https://jobs.lever.co/acme/abc?lever-source=x")!;
        const b = canonicalJobUrl("http://jobs.lever.co/acme/abc/")!;
        expect(jobUrlKey(a)).toBe(jobUrlKey(b));
    });
});
