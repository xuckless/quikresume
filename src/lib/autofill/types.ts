// src/lib/autofill/types.ts
// "Autofill preferences" (users/{uid}/meta/autofill): what application forms ask that the library and
// About you don't hold. Pure: shared by the page, the server routes and (by shape) the extension.

export type YesNo = "yes" | "no" | "";
export type SalaryPeriod = "year" | "month" | "hour";

export interface AutofillAddress { street: string; street2: string; city: string; region: string; postalCode: string; country: string }
export interface AutofillSalary { min: string; target: string; currency: string; period: SalaryPeriod }
export interface AutofillEeo { gender: string; pronouns: string; ethnicity: string; veteran: string; disability: string; lgbtq: string }
export interface SavedAnswer { id: string; question: string; answer: string }
export interface UnmappedField { label: string; host: string; at: string }

export interface AutofillPrefs {
    address: AutofillAddress;
    salary: AutofillSalary;
    noticePeriod: string;
    earliestStart: string;
    /** Legally authorised to work where the job is. */
    workAuthorized: YesNo;
    needsSponsorship: YesNo;
    willingToRelocate: YesNo;
    eeo: AutofillEeo;
    howDidYouHear: string;
    /** Reusable answers for questions the form asks often ("Why do you want to work here?" defaults, etc.). */
    answers: SavedAnswer[];
    /** The user's instructions to the AI that drafts free-text answers. */
    agentInstructions: string;
    /** Fields the extension met but could not fill, offered here as new answers. */
    unmapped: UnmappedField[];
}

export const DECLINE = "Decline to answer";

export const EEO_OPTIONS: Record<keyof AutofillEeo, string[]> = {
    gender: [DECLINE, "Woman", "Man", "Non-binary", "Prefer to self-describe"],
    pronouns: [DECLINE, "she/her", "he/him", "they/them"],
    ethnicity: [DECLINE, "Asian", "Black or African American", "Hispanic or Latino", "Indigenous", "Middle Eastern or North African", "Native Hawaiian or Pacific Islander", "White", "Two or more"],
    veteran: [DECLINE, "I am not a protected veteran", "I am a protected veteran"],
    disability: [DECLINE, "No, I do not have a disability", "Yes, I have a disability"],
    lgbtq: [DECLINE, "No", "Yes"],
};

export const LIMITS_AUTOFILL = { short: 120, answer: 2000, instructions: 2000, answers: 40, unmapped: 50 } as const;

export function defaultAutofillPrefs(): AutofillPrefs {
    return {
        address: { street: "", street2: "", city: "", region: "", postalCode: "", country: "" },
        salary: { min: "", target: "", currency: "USD", period: "year" },
        noticePeriod: "",
        earliestStart: "",
        workAuthorized: "",
        needsSponsorship: "",
        willingToRelocate: "",
        eeo: { gender: DECLINE, pronouns: DECLINE, ethnicity: DECLINE, veteran: DECLINE, disability: DECLINE, lgbtq: DECLINE },
        howDidYouHear: "",
        answers: [],
        agentInstructions: "",
        unmapped: [],
    };
}

const str = (v: unknown, max: number = LIMITS_AUTOFILL.short) =>
    typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max) : "";
const yn = (v: unknown): YesNo => (v === "yes" || v === "no" ? v : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Lenient read + clamp of anything claiming to be prefs (Firestore doc or client input). */
export function readAutofillPrefs(raw: unknown): AutofillPrefs {
    const d = defaultAutofillPrefs();
    const o = obj(raw);
    const a = obj(o.address);
    const s = obj(o.salary);
    const e = obj(o.eeo);
    const eeo = { ...d.eeo };
    for (const k of Object.keys(eeo) as (keyof AutofillEeo)[]) eeo[k] = str(e[k]) || DECLINE;
    return {
        address: { street: str(a.street), street2: str(a.street2), city: str(a.city), region: str(a.region), postalCode: str(a.postalCode, 20), country: str(a.country) },
        salary: {
            min: str(s.min, 20), target: str(s.target, 20), currency: str(s.currency, 3).toUpperCase() || "USD",
            period: s.period === "hour" || s.period === "month" ? s.period : "year",
        },
        noticePeriod: str(o.noticePeriod),
        earliestStart: /^\d{4}-\d{2}-\d{2}$/.test(String(o.earliestStart)) ? String(o.earliestStart) : "",
        workAuthorized: yn(o.workAuthorized),
        needsSponsorship: yn(o.needsSponsorship),
        willingToRelocate: yn(o.willingToRelocate),
        eeo,
        howDidYouHear: str(o.howDidYouHear),
        answers: (Array.isArray(o.answers) ? o.answers : []).slice(0, LIMITS_AUTOFILL.answers).map((x, i) => {
            const q = obj(x);
            return { id: str(q.id, 40) || `a${i}`, question: str(q.question, 300), answer: str(q.answer, LIMITS_AUTOFILL.answer) };
        }).filter(x => x.question && x.answer),
        agentInstructions: str(o.agentInstructions, LIMITS_AUTOFILL.instructions),
        unmapped: (Array.isArray(o.unmapped) ? o.unmapped : []).slice(-LIMITS_AUTOFILL.unmapped).map(x => {
            const u = obj(x);
            return { label: str(u.label, 200), host: str(u.host, 120), at: str(u.at, 40) };
        }).filter(u => u.label),
    };
}
