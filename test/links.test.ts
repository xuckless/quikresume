import { describe, expect, it } from "vitest";
import { mergeLinks, normalizeLinks, readLinks } from "@/lib/contact/links";
import { emptyResumeData } from "@/types/schema";
import { toTypstDoc } from "@/lib/typst/doc";
import { readResumeBody } from "@/lib/match/resume-body";

describe("extra links", () => {
    it("reads untrusted input defensively", () => {
        expect(readLinks([{ label: "  Portfolio  ", url: " behance.net/x " }, { label: "x" }, "junk", null])).toEqual([{ label: "Portfolio", url: "behance.net/x" }]);
        expect(readLinks(Array.from({ length: 20 }, (_, i) => ({ label: "", url: `a${i}.dev` })))).toHaveLength(6);
        expect(readLinks("nope")).toEqual([]);
    });
    it("normalises URLs, drops duplicates, reports bad ones", () => {
        const r = normalizeLinks([{ label: "ORCID", url: "orcid.org/0000-0002-1825-0097" }, { label: "", url: "https://orcid.org/0000-0002-1825-0097/" }, { label: "", url: "not a link" }]);
        expect(r.links.map(l => l.url)).toEqual(["https://orcid.org/0000-0002-1825-0097", "not a link"]);
        expect(r.issues[1]).toBeTruthy();
    });
    it("merges by URL, existing first", () => {
        expect(mergeLinks([{ label: "Portfolio", url: "https://a.dev" }], [{ label: "", url: "a.dev" }, { label: "Blog", url: "b.dev" }]))
            .toEqual([{ label: "Portfolio", url: "https://a.dev" }, { label: "Blog", url: "https://b.dev" }]);
    });
    it("reach the Typst header, and old bodies without links still parse", () => {
        const d = emptyResumeData();
        d.links = [{ label: "Portfolio", url: "https://a.dev" }];
        expect(toTypstDoc(d).header.links).toEqual([{ label: "Portfolio", url: "https://a.dev" }]);
        const old: Partial<ReturnType<typeof emptyResumeData>> = emptyResumeData();
        delete old.links;
        expect(readResumeBody(old)?.links).toEqual([]);
    });
});
