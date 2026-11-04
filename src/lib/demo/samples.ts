// src/lib/demo/samples.ts
// Sample libraries + one job each for the landing-page demo and the /start "try a sample" path.
// Plain data, scored with the real pure scorer (lib/match/score.ts): tags stand in for what the
// tagger would produce. Fictional people and employers.

import { emptyResumeData, type ResumeData } from "@/types/schema";
import { makeTag } from "@/lib/tags/normalize";
import type { TagKind } from "@/lib/tags/types";
import type { Requirement } from "@/lib/match/types";

export type DemoProfession = "software" | "nursing" | "accounting" | "electrician";

export interface DemoSample {
    id: DemoProfession;
    label: string;
    resume: ResumeData;
    job: { title: string; company: string; requirements: Requirement[] };
}

type T = [string, TagKind];
const tags = (list: T[]) => list.map(([n, k]) => makeTag(n, k)!).filter(Boolean);
const req = (name: string, kind: TagKind, importance: "must" | "nice" = "must", yearsMin: number | null = null): Requirement => {
    const t = makeTag(name, kind)!;
    return { ...t, importance, yearsMin, satisfiedBy: [], evidence: [], reason: "", semantic: [] };
};

let n = 0;
const id = (p: string) => `demo-${p}-${++n}`;

function base(first: string, last: string, headline: string, location: string, summary: string): ResumeData {
    const d = emptyResumeData();
    d.personalInfo = { ...d.personalInfo, firstName: first, lastName: last, headline, location, email: `${first.toLowerCase()}@example.com`, phone: "(555) 010-0100", summary };
    return d;
}

function work(p: string, title: string, company: string, start: string, end: string, bullets: string[], t: T[], isSelected = true) {
    return { id: id(p), title, company, startDate: start, endDate: end, description: bullets.join("\n"), hidden: [], isSelected, tags: tags(t), tagsHash: null };
}
function edu(p: string, degree: string, institution: string, start: string, end: string, t: T[]) {
    return { id: id(p), degree, institution, startDate: start, endDate: end, gpa: "", minor: "", details: "", isSelected: true, tags: tags(t), tagsHash: null };
}
function skills(p: string, category: string, items: string[], isSelected = true) {
    return { id: id(p), category, items: items.join(", "), hidden: [], isSelected, tags: tags(items.map(i => [i, "technical-skill"] as T)), tagsHash: null };
}
function cert(p: string, name: string, issuer: string, year: string, t: T[]) {
    return { id: id(p), name, issuer, year, credentialId: "", expires: "", isSelected: true, tags: tags(t), tagsHash: null };
}

function software(): DemoSample {
    const d = base("Maya", "Chen", "Software Engineer", "Toronto, ON", "Backend engineer who ships reliable services and the tooling around them.");
    d.workExperience = [
        work("sw", "Software Engineer", "Northwind Payments", "2022-03-01", "Present", [
            "Split a monolith into 5 Go services behind gRPC, cutting p95 latency 38%",
            "Moved deploys to Kubernetes with GitHub Actions; releases went from weekly to daily",
            "Led on-call for the ledger team and wrote its runbooks",
        ], [["Go", "technical-skill"], ["Microservices", "technical-skill"], ["Kubernetes", "tool-platform"], ["GitHub Actions", "tool-platform"], ["CI/CD", "methodology"], ["Leadership", "soft-skill"], ["Fintech", "domain"]]),
        work("sw", "Junior Developer", "Pixel & Pine", "2020-06-01", "2022-02-01", [
            "Built React dashboards for 40 retail clients",
            "Wrote the PostgreSQL reporting queries behind monthly invoices",
        ], [["React", "technical-skill"], ["TypeScript", "technical-skill"], ["PostgreSQL", "tool-platform"], ["SQL", "technical-skill"]]),
        work("sw", "Barista", "Grind House", "2018-05-01", "2020-05-01", ["Trained 6 new staff"], [["Customer Service", "soft-skill"]], false),
    ];
    d.education = [edu("sw", "B.Sc. Computer Science", "University of Waterloo", "2016-09-01", "2020-04-01", [["Bachelor of Science", "credential"], ["Bachelor's Degree", "credential"], ["Computer Science", "credential"]])];
    d.skills = [
        skills("sw", "Languages", ["Go", "TypeScript", "Python", "SQL"]),
        skills("sw", "Infrastructure", ["Kubernetes", "Docker", "Terraform", "Amazon Web Services"]),
        skills("sw", "Frontend", ["React", "Next.js", "Tailwind CSS"], false),
    ];
    return {
        id: "software", label: "Software", resume: d,
        job: { title: "Senior Backend Engineer", company: "Lumen Health", requirements: [
            req("Go", "technical-skill", "must", 3), req("Kubernetes", "tool-platform"), req("PostgreSQL", "tool-platform"), req("Microservices", "technical-skill"),
            req("Amazon Web Services", "tool-platform"), req("Bachelor's Degree", "credential"), req("Terraform", "tool-platform", "nice"), req("Leadership", "soft-skill", "nice"),
            req("Kafka", "tool-platform", "nice"), req("Healthcare", "domain", "nice"),
        ] },
    };
}

function nursing(): DemoSample {
    const d = base("Amara", "Okafor", "Registered Nurse, Critical Care", "Hamilton, ON", "ICU nurse with five years of acute care, calm under pressure and fluent in Epic.");
    d.workExperience = [
        work("rn", "Registered Nurse, ICU", "St. Brigid's Hospital", "2021-01-01", "Present", [
            "Cared for 2 ventilated patients per shift in a 24-bed ICU",
            "Titrated vasoactive drips and documented hourly assessments in Epic",
            "Precepted 9 new graduate nurses",
        ], [["Critical Care", "domain"], ["Patient Assessment", "technical-skill"], ["Medication Administration", "technical-skill"], ["Epic", "tool-platform"], ["Mentoring", "soft-skill"]]),
        work("rn", "Registered Nurse, Medicine", "Lakeshore General", "2019-06-01", "2020-12-01", [
            "Managed 6 patients on a 32-bed medical unit",
            "Started and maintained IV therapy; led the unit's falls-prevention audit",
        ], [["Acute Care", "domain"], ["IV Therapy", "technical-skill"], ["Patient Safety", "methodology"]]),
        work("rn", "Personal Support Worker", "Maple Grove LTC", "2016-05-01", "2019-04-01", ["Supported daily living for 12 residents"], [["Patient Care", "technical-skill"]], false),
    ];
    d.education = [edu("rn", "BScN, Nursing", "McMaster University", "2015-09-01", "2019-05-01", [["Bachelor of Science in Nursing", "credential"], ["Bachelor's Degree", "credential"], ["Nursing", "credential"]])];
    d.certifications = [
        cert("rn", "Registered Nurse (RN)", "College of Nurses of Ontario", "2019", [["Registered Nurse", "credential"]]),
        cert("rn", "ACLS", "Heart and Stroke Foundation", "2022", [["Advanced Cardiovascular Life Support", "credential"]]),
        cert("rn", "BLS", "Heart and Stroke Foundation", "2024", [["Basic Life Support", "credential"]]),
    ];
    d.skills = [skills("rn", "Clinical", ["Patient Assessment", "Ventilator Management", "IV Therapy", "Wound Care"])];
    return {
        id: "nursing", label: "Nursing", resume: d,
        job: { title: "Registered Nurse, Cardiac ICU", company: "Northshore Health", requirements: [
            req("Registered Nurse", "credential"), req("Bachelor of Science in Nursing", "credential"), req("Critical Care", "domain", "must", 2), req("Advanced Cardiovascular Life Support", "credential"),
            req("Basic Life Support", "credential"), req("Epic", "tool-platform"), req("Patient Assessment", "technical-skill"), req("Cardiac Care", "domain", "nice"),
            req("Mentoring", "soft-skill", "nice"), req("French", "language", "nice"),
        ] },
    };
}

function accounting(): DemoSample {
    const d = base("Daniel", "Reyes", "Senior Accountant, CPA", "Calgary, AB", "CPA who closes the books on time and makes month-end boring.");
    d.workExperience = [
        work("ac", "Senior Accountant", "Prairie Foods Ltd.", "2021-08-01", "Present", [
            "Cut month-end close from 9 to 5 days by automating 40 reconciliations",
            "Prepared consolidated statements under IFRS for 3 entities",
            "Owned the NetSuite rollout for accounts payable",
        ], [["Month-End Close", "technical-skill"], ["Account Reconciliation", "technical-skill"], ["IFRS", "methodology"], ["Financial Reporting", "technical-skill"], ["NetSuite", "tool-platform"]]),
        work("ac", "Staff Accountant", "Birch & Co. CPA", "2018-09-01", "2021-07-01", [
            "Audited 20 small-business clients",
            "Built Excel models for tax planning",
        ], [["Audit", "technical-skill"], ["Microsoft Excel", "tool-platform"], ["Tax Planning", "technical-skill"]]),
    ];
    d.education = [edu("ac", "Bachelor of Commerce, Accounting", "University of Calgary", "2014-09-01", "2018-04-01", [["Bachelor of Commerce", "credential"], ["Bachelor's Degree", "credential"], ["Accounting", "credential"]])];
    d.certifications = [cert("ac", "Chartered Professional Accountant (CPA)", "CPA Alberta", "2020", [["CPA", "credential"]])];
    d.skills = [skills("ac", "Tools", ["Microsoft Excel", "NetSuite", "QuickBooks", "Power BI"])];
    return {
        id: "accounting", label: "Accounting", resume: d,
        job: { title: "Accounting Manager", company: "Glacier Outdoor", requirements: [
            req("CPA", "credential"), req("Month-End Close", "technical-skill"), req("Financial Reporting", "technical-skill", "must", 5), req("IFRS", "methodology"),
            req("NetSuite", "tool-platform", "nice"), req("Microsoft Excel", "tool-platform"), req("Team Leadership", "soft-skill"), req("Bachelor's Degree", "credential"),
            req("Audit", "technical-skill", "nice"), req("Power BI", "tool-platform", "nice"),
        ] },
    };
}

function electrician(): DemoSample {
    const d = base("Jordan", "Blake", "Journeyman Electrician", "Edmonton, AB", "Licensed journeyman with commercial and industrial experience. Clean installs, passed inspections.");
    d.workExperience = [
        work("el", "Journeyman Electrician", "Volt Line Electric", "2020-04-01", "Present", [
            "Installed power and lighting for 14 commercial fit-outs to code",
            "Bent and ran EMT and rigid conduit; pulled and terminated 600V feeders",
            "Read blueprints and led a crew of 3 apprentices",
        ], [["Commercial Construction", "domain"], ["Electrical Installation", "technical-skill"], ["Conduit Bending", "technical-skill"], ["Blueprint Reading", "technical-skill"], ["Leadership", "soft-skill"]]),
        work("el", "Electrical Apprentice", "Summit Industrial", "2016-05-01", "2020-03-01", [
            "Maintained motor controls and PLC panels at a packaging plant",
            "Troubleshot faults with multimeters and megohmmeters",
        ], [["Industrial Maintenance", "domain"], ["Motor Controls", "technical-skill"], ["Troubleshooting", "technical-skill"], ["PLC", "technical-skill"]]),
    ];
    d.education = [edu("el", "Electrician Program", "NAIT", "2016-09-01", "2020-03-01", [["Electrician Apprenticeship", "credential"]])];
    d.certifications = [
        cert("el", "Journeyman Electrician (Red Seal)", "Alberta Apprenticeship and Industry Training", "2020", [["Journeyman Electrician", "credential"], ["Red Seal", "credential"]]),
        cert("el", "Working at Heights", "Alberta Construction Safety Association", "2023", [["Working at Heights", "credential"]]),
    ];
    d.skills = [skills("el", "Trade", ["Canadian Electrical Code", "Conduit Bending", "Motor Controls", "Fire Alarm Systems"])];
    return {
        id: "electrician", label: "Electrician", resume: d,
        job: { title: "Industrial Electrician", company: "Northern Pulp", requirements: [
            req("Journeyman Electrician", "credential"), req("Red Seal", "credential"), req("Motor Controls", "technical-skill"), req("PLC", "technical-skill"),
            req("Troubleshooting", "technical-skill"), req("Industrial Maintenance", "domain", "must", 3), req("Canadian Electrical Code", "methodology"),
            req("Working at Heights", "credential", "nice"), req("Variable Frequency Drives", "technical-skill", "nice"), req("Leadership", "soft-skill", "nice"),
        ] },
    };
}

export function demoSamples(): DemoSample[] {
    n = 0;
    return [software(), nursing(), accounting(), electrician()];
}
