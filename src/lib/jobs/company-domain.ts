// src/lib/jobs/company-domain.ts
// The company's own website domain, for its logo in the Job Tracker. Pure.
// Sources, best first: what the JD analysis returned (job.companyDomain), then the posting URL when it is
// on the company's own site (careers.acme.com -> acme.com). Job boards and ATS hosts never count: a
// LinkedIn or Greenhouse URL says nothing about whose job it is.

const BOARDS = [
    "linkedin.com", "indeed.com", "indeed.ca", "glassdoor.com", "glassdoor.ca", "greenhouse.io", "lever.co", "ashbyhq.com",
    "myworkdayjobs.com", "workday.com", "wellfound.com", "angel.co", "smartrecruiters.com", "bamboohr.com", "workable.com",
    "ziprecruiter.com", "monster.com", "monster.ca", "jobvite.com", "icims.com", "recruitee.com", "teamtailor.com",
    "breezy.hr", "jazzhr.com", "applytojob.com", "simplyhired.com", "dice.com", "builtin.com", "ycombinator.com",
    "workatastartup.com", "otta.com", "welcometothejungle.com", "jobbank.gc.ca", "adzuna.com", "talent.com", "eluta.ca",
    "careerbuilder.com", "google.com", "rippling.com", "paylocity.com", "ultipro.com", "ukg.com", "taleo.net",
    "successfactors.com", "oraclecloud.com", "personio.de", "personio.com", "pinpointhq.com", "dover.com", "gem.com",
];

// Second-level labels under country TLDs ("acme.co.uk", "acme.com.au").
const SLD = new Set(["co", "com", "org", "net", "ac", "gov", "edu", "ltd", "plc"]);

const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

/** "careers.Acme.co.uk" -> "acme.co.uk"; null for IPs, localhost and malformed input. */
export function registrableDomain(host: string): string | null {
    const h = host.trim().toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    if (!DOMAIN_RE.test(h)) return null;
    const parts = h.split(".");
    const n = parts.length >= 3 && parts[parts.length - 1].length === 2 && SLD.has(parts[parts.length - 2]) ? 3 : 2;
    return parts.slice(-n).join(".");
}

export const isJobBoard = (domain: string) => BOARDS.some(b => domain === b || domain.endsWith(`.${b}`));

/** A model- or user-supplied domain, cleaned ("https://www.acme.com/about" -> "acme.com"); null when unusable. */
export function cleanCompanyDomain(raw: unknown): string | null {
    if (typeof raw !== "string" || !raw.trim()) return null;
    let host = raw.trim();
    try { host = new URL(/^[a-z]+:\/\//i.test(host) ? host : `https://${host}`).hostname; } catch { return null; }
    const d = registrableDomain(host);
    return d && !isJobBoard(d) ? d : null;
}

export function companyDomainOf(job: { companyDomain?: string | null; url?: string | null }): string | null {
    if (job.companyDomain) return job.companyDomain;
    return job.url ? cleanCompanyDomain(job.url) : null;
}
