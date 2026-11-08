import { describe, expect, it } from "vitest";
import { cleanCompanyDomain, companyDomainOf, registrableDomain } from "@/lib/jobs/company-domain";

describe("company domain", () => {
    it("reduces hosts to the registrable domain", () => {
        expect(registrableDomain("careers.Shopify.com")).toBe("shopify.com");
        expect(registrableDomain("jobs.nhs.co.uk")).toBe("nhs.co.uk");
        expect(registrableDomain("www.acme.io")).toBe("acme.io");
        expect(registrableDomain("localhost")).toBeNull();
        expect(registrableDomain("10.0.0.1")).toBeNull();
    });
    it("never takes a job board's domain", () => {
        expect(cleanCompanyDomain("https://www.linkedin.com/jobs/view/123")).toBeNull();
        expect(cleanCompanyDomain("https://boards.greenhouse.io/acme/jobs/1")).toBeNull();
        expect(cleanCompanyDomain("https://acme.wd5.myworkdayjobs.com/en-US/careers")).toBeNull();
        expect(cleanCompanyDomain("https://careers.acme.com/jobs/1")).toBe("acme.com");
        expect(cleanCompanyDomain("Acme.com/about")).toBe("acme.com");
        expect(cleanCompanyDomain("not a domain")).toBeNull();
    });
    it("prefers the analysed domain over the posting URL", () => {
        expect(companyDomainOf({ companyDomain: "stripe.com", url: "https://jobs.lever.co/stripe/1" })).toBe("stripe.com");
        expect(companyDomainOf({ companyDomain: null, url: "https://jobs.lever.co/stripe/1" })).toBeNull();
        expect(companyDomainOf({ url: "https://careers.mcgill.ca/job/1" })).toBe("mcgill.ca");
    });
});
