import { describe, expect, it } from "vitest";
import { canonicalProfileUrl } from "@/lib/import/linkedin";

describe("canonicalProfileUrl", () => {
    it("canonicalises profile pages", () => {
        expect(canonicalProfileUrl("https://linkedin.com/in/some-person/?trk=foo")).toBe("https://www.linkedin.com/in/some-person");
        expect(canonicalProfileUrl(" https://www.linkedin.com/in/Some-Person#about ")).toBe("https://www.linkedin.com/in/some-person");
        expect(canonicalProfileUrl("https://www.linkedin.com/in/j%C3%BCrgen-m")).toBe("https://www.linkedin.com/in/j%C3%BCrgen-m");
        expect(canonicalProfileUrl("https://www.linkedin.com/in/J%C3%9CRGEN-M/")).toBe("https://www.linkedin.com/in/j%C3%BCrgen-m");
    });

    it.each([
        "https://linkedin.com.evil/in/person",
        "https://evil@linkedin.com/in/person",
        "http://linkedin.com/in/person",
        "https://www.linkedin.com/in/person/details/experience",
        "https://www.linkedin.com:444/in/person",
        "https://www.linkedin.com/in/%2fperson",
        "https://uk.linkedin.com/in/person",
        "https://www.linkedin.com/company/acme",
        "linkedin.com/in/person",
        "not a url",
    ])("rejects %s", url => expect(canonicalProfileUrl(url)).toBeNull());
});
