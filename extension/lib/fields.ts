// Application-form field detection, classification and filling. Pure DOM (jsdom-tested in
// fields.test.ts). Never submits, never overwrites a field that already has a value, and only touches
// visible, enabled controls.
//
//   scanFields(doc)        -> FormField[]: each control (radio groups merged) with its best label
//   classify(field)        -> FieldKey | "question" | null   (regex rules over label + name + autocomplete)
//   valueFor(key, data)    -> the deterministic value from profile + Autofill preferences
//   fillField(field, val)  -> sets it the way a user would (native setter + input/change events, so
//                             React / Vue controlled inputs register the value)

export type FieldKey =
    | "firstName" | "lastName" | "fullName" | "email" | "phone" | "location" | "street" | "street2" | "city" | "region"
    | "postalCode" | "country" | "linkedin" | "github" | "website" | "currentTitle" | "currentCompany" | "school" | "degree"
    | "graduation" | "yearsExperience" | "salary" | "noticePeriod" | "startDate" | "workAuthorized" | "needsSponsorship"
    | "relocate" | "gender" | "pronouns" | "ethnicity" | "veteran" | "disability" | "lgbtq" | "howDidYouHear" | "resume"
    | "coverLetter";

export type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export interface FormField {
    /** Stable within one scan: used to match AI answers back to fields. */
    id: string;
    kind: "text" | "textarea" | "select" | "radio" | "checkbox" | "file" | "date";
    label: string;
    /** name / id / autocomplete, for classification only. */
    hints: string;
    options: string[];
    required: boolean;
    maxLength: number | null;
    elements: Control[];
}

export interface AutofillData {
    profile: {
        firstName: string; lastName: string; email: string; phone: string; location: string; linkedin: string; github: string;
        website: string; headline: string; currentTitle: string; currentCompany: string; school: string; degree: string;
        graduation: string; yearsExperience: number | null;
    };
    prefs: {
        address: { street: string; street2: string; city: string; region: string; postalCode: string; country: string };
        salary: { min: string; target: string; currency: string; period: string };
        noticePeriod: string; earliestStart: string;
        workAuthorized: "yes" | "no" | ""; needsSponsorship: "yes" | "no" | ""; willingToRelocate: "yes" | "no" | "";
        eeo: { gender: string; pronouns: string; ethnicity: string; veteran: string; disability: string; lgbtq: string };
        howDidYouHear: string;
    };
}

const norm = (s: string) => s.toLowerCase().replace(/[*:]/g, " ").replace(/[^a-z0-9?' ]+/g, " ").replace(/\s+/g, " ").trim();

// ---------- labels

function textOf(el: Element | null | undefined): string {
    if (!el) return "";
    const clone = el.cloneNode(true) as Element;
    clone.querySelectorAll("input,select,textarea,button,script,style,svg,option").forEach(n => n.remove());
    return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

function labelFor(el: Control, doc: Document): string {
    const byId = (ids: string) => ids.split(/\s+/).map(id => textOf(doc.getElementById(id))).filter(Boolean).join(" ");
    const labelled = el.getAttribute("aria-labelledby");
    if (labelled) { const t = byId(labelled); if (t) return t; }
    if (el.id) {
        const l = Array.from(doc.getElementsByTagName("label")).find(x => x.htmlFor === el.id);
        const t = textOf(l);
        if (t) return t;
    }
    const wrap = el.closest("label");
    if (wrap) { const t = textOf(wrap); if (t) return t; }
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim();
    // Field wrappers used by ATSs (Workday data-automation-id, generic .field / .form-group).
    let node: Element | null = el.parentElement;
    for (let i = 0; i < 4 && node; i++, node = node.parentElement) {
        // Only a wrapper of this one control: a bigger container's label belongs to another field.
        if (node.querySelectorAll("input:not([type=hidden]), select, textarea").length > 1) break;
        const l = node.querySelector(":scope > label, :scope > legend, :scope > [class*='label' i], :scope > [data-automation-id*='label' i]");
        const t = textOf(l);
        if (t) return t;
    }
    return (el.getAttribute("placeholder") ?? el.getAttribute("title") ?? "").trim();
}

function legendFor(el: Element): string {
    const fs = el.closest("fieldset");
    const t = textOf(fs?.querySelector("legend"));
    if (t) return t;
    const group = el.closest("[role='radiogroup'], [role='group']");
    if (group) {
        const by = group.getAttribute("aria-labelledby");
        if (by) return by.split(/\s+/).map(id => textOf(el.ownerDocument.getElementById(id))).join(" ").trim();
        const al = group.getAttribute("aria-label");
        if (al) return al;
    }
    return "";
}

function visible(el: HTMLElement): boolean {
    if (el.hidden || (el as HTMLInputElement).disabled || el.getAttribute("aria-hidden") === "true") return false;
    const style = el.ownerDocument.defaultView?.getComputedStyle(el);
    if (style && (style.display === "none" || style.visibility === "hidden")) return false;
    // Styled radios / checkboxes are often 0×0 behind their label; jsdom has no layout at all.
    const type = (el as HTMLInputElement).type;
    if (type === "radio" || type === "checkbox" || /jsdom/.test(el.ownerDocument.defaultView?.navigator.userAgent ?? "")) return true;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
}

export function scanFields(doc: Document): FormField[] {
    const out: FormField[] = [];
    const radios = new Map<string, HTMLInputElement[]>();
    let n = 0;
    for (const el of Array.from(doc.querySelectorAll<Control>("input, select, textarea"))) {
        const type = el instanceof HTMLInputElement ? el.type.toLowerCase() : el instanceof HTMLSelectElement ? "select" : "textarea";
        if (["hidden", "submit", "button", "reset", "image", "search", "password"].includes(type)) continue;
        if (type !== "file" && !visible(el as HTMLElement)) continue;
        if (type === "radio") {
            const key = (el as HTMLInputElement).name || `__radio${n++}`;
            radios.set(key, [...(radios.get(key) ?? []), el as HTMLInputElement]);
            continue;
        }
        const label = labelFor(el, doc);
        out.push({
            id: `f${n++}`,
            kind: type === "select" ? "select" : type === "textarea" ? "textarea" : type === "checkbox" ? "checkbox" : type === "file" ? "file" : type === "date" || type === "month" ? "date" : "text",
            label,
            hints: [el.getAttribute("name"), el.id, el.getAttribute("autocomplete"), el.getAttribute("data-automation-id"), type].filter(Boolean).join(" "),
            options: el instanceof HTMLSelectElement ? Array.from(el.options).map(o => o.text.trim()).filter(t => t && !/^(select|choose|please select|--)/i.test(t)) : [],
            required: el.required || el.getAttribute("aria-required") === "true" || /\*\s*$/.test(label),
            maxLength: "maxLength" in el && el.maxLength > 0 ? el.maxLength : null,
            elements: [el],
        });
    }
    for (const [name, group] of radios) {
        const first = group[0]!;
        out.push({
            id: `f${n++}`,
            kind: "radio",
            label: legendFor(first) || labelFor(first, doc),
            hints: name,
            options: group.map(r => labelFor(r, doc)),
            required: group.some(r => r.required),
            maxLength: null,
            elements: group,
        });
    }
    return out;
}

// ---------- classification

const RULES: [FieldKey, RegExp][] = [
    ["resume", /\b(resume|résumé|cv|curriculum)\b/],
    ["coverLetter", /\bcover ?letter\b/],
    ["email", /\be ?mail\b/],
    ["firstName", /\b(first|given|fore) ?name\b|\bfname\b|given-name/],
    ["lastName", /\b(last|family|sur) ?name\b|\blname\b|\bsurname\b|family-name/],
    ["fullName", /^(full )?name$|\bfull ?name\b|\byour name\b|^name\b/],
    ["phone", /\b(phone|mobile|cell|telephone)\b|\btel\b/],
    ["linkedin", /linked ?in/],
    ["github", /\bgit ?hub\b/],
    ["website", /\b(website|portfolio|personal (site|url)|blog)\b|\burl\b/],
    ["street2", /\b(address ?(line)? ?2|apartment|apt|suite|unit)\b|address-line2/],
    ["street", /\b(street|address ?(line)? ?1?|mailing address)\b|address-line1/],
    ["postalCode", /\b(zip|postal|post ?code)\b/],
    ["city", /\b(city|town)\b|address-level2/],
    ["region", /\b(state|province|region)\b|address-level1/],
    ["country", /\bcountry\b/],
    ["location", /\b(location|where are you (located|based)|current location)\b/],
    ["currentCompany", /\b(current|most recent|present) (company|employer)\b|\bemployer\b/],
    ["currentTitle", /\b(current|most recent|present) (job )?(title|position|role)\b/],
    ["school", /\b(school|university|college|institution)\b/],
    ["degree", /\b(degree|qualification)\b/],
    ["graduation", /\bgraduat(ion|ed)\b/],
    ["yearsExperience", /\byears? of (professional |relevant )?experience\b|\bhow many years\b/],
    ["salary", /\b(salary|compensation|pay|rate) (expectation|requirement|range|desired)|\bdesired (salary|pay|compensation)\b|\bexpected (salary|compensation)\b/],
    ["noticePeriod", /\bnotice period\b/],
    ["startDate", /\b(start date|available to start|earliest (start|availability)|when can you start)\b/],
    ["needsSponsorship", /\b(sponsor|sponsorship|visa)\b/],
    ["workAuthorized", /\b(authori[sz]ed|eligible|legally (able|permitted)|right) to work\b|\bwork (authori[sz]ation|permit)\b/],
    ["relocate", /\breloca(te|tion)\b/],
    ["pronouns", /\bpronouns?\b/],
    ["gender", /\bgender\b|\bsex\b/],
    ["ethnicity", /\b(race|ethnic|hispanic|latino)\b/],
    ["veteran", /\bveteran\b|\bmilitary\b/],
    ["disability", /\bdisabilit/],
    ["lgbtq", /\blgbt|\bsexual orientation\b|\btransgender\b/],
    ["howDidYouHear", /\b(how did you (hear|find|learn)|source|referr(al|ed) (source|by))\b/],
];

const FACT_KEYS = new Set<FieldKey>([
    "firstName", "lastName", "fullName", "email", "phone", "location", "street", "street2", "city", "region", "postalCode", "country",
    "linkedin", "github", "website", "currentTitle", "currentCompany", "school", "degree", "graduation", "salary",
]);

/** A deterministic key, "question" for open questions the AI should draft, or null to leave alone. */
export function classify(f: FormField): FieldKey | "question" | null {
    const label = norm(f.label);
    const hay = `${label} ${norm(f.hints.replace(/[_-]+/g, " "))}`;
    if (f.kind === "file") {
        if (/cover ?letter/.test(hay)) return "coverLetter";
        return /resume|résumé|\bcv\b|attach/.test(hay) ? "resume" : null;
    }
    // Long questions are about the candidate's story even when they contain a keyword ("Why are you
    // interested in relocating?", "Have you worked for this employer before?"). Yes/no eligibility and
    // self-identification questions are long by nature and keep their key.
    const isQuestion = label.length > 60 || (label.endsWith("?") && label.split(" ").length > 6);
    for (const [key, re] of RULES) {
        if (key === "resume" || key === "coverLetter") continue;
        if (re.test(hay)) {
            if (isQuestion && (f.kind === "textarea" || FACT_KEYS.has(key))) return "question";
            return key;
        }
    }
    if (f.kind === "checkbox") return null; // consent boxes etc.: the user ticks those
    if (f.kind === "textarea" || ((f.kind === "text" || f.kind === "select" || f.kind === "radio") && label.length >= 12)) return "question";
    return null;
}

// ---------- values

const yesNo = (v: "yes" | "no" | "") => (v === "yes" ? "Yes" : v === "no" ? "No" : "");

export function valueFor(key: FieldKey, d: AutofillData): string {
    const p = d.profile;
    const a = d.prefs.address;
    switch (key) {
        case "firstName": return p.firstName;
        case "lastName": return p.lastName;
        case "fullName": return [p.firstName, p.lastName].filter(Boolean).join(" ");
        case "email": return p.email;
        case "phone": return p.phone;
        case "location": return p.location || [a.city, a.region, a.country].filter(Boolean).join(", ");
        case "street": return a.street;
        case "street2": return a.street2;
        case "city": return a.city || p.location.split(",")[0]?.trim() || "";
        case "region": return a.region;
        case "postalCode": return a.postalCode;
        case "country": return a.country;
        case "linkedin": return p.linkedin;
        case "github": return p.github;
        case "website": return p.website;
        case "currentTitle": return p.currentTitle;
        case "currentCompany": return p.currentCompany;
        case "school": return p.school;
        case "degree": return p.degree;
        case "graduation": return p.graduation;
        case "yearsExperience": return p.yearsExperience === null ? "" : String(Math.floor(p.yearsExperience));
        case "salary": return d.prefs.salary.target || d.prefs.salary.min;
        case "noticePeriod": return d.prefs.noticePeriod;
        case "startDate": return d.prefs.earliestStart;
        case "workAuthorized": return yesNo(d.prefs.workAuthorized);
        case "needsSponsorship": return yesNo(d.prefs.needsSponsorship);
        case "relocate": return yesNo(d.prefs.willingToRelocate);
        case "gender": return d.prefs.eeo.gender;
        case "pronouns": return d.prefs.eeo.pronouns;
        case "ethnicity": return d.prefs.eeo.ethnicity;
        case "veteran": return d.prefs.eeo.veteran;
        case "disability": return d.prefs.eeo.disability;
        case "lgbtq": return d.prefs.eeo.lgbtq;
        case "howDidYouHear": return d.prefs.howDidYouHear;
        case "resume":
        case "coverLetter": return "";
    }
}

// ---------- options

const DECLINE_RE = /\b(decline|prefer not|don'?t wish|do not wish|not to (say|answer|disclose)|choose not)\b/;

/** Best option for a value: exact, then contains / contained, then yes/no and "decline" synonyms. */
export function matchOption(options: string[], value: string): number {
    if (!value) return -1;
    const v = norm(value);
    const opts = options.map(norm);
    let i = opts.indexOf(v);
    if (i >= 0) return i;
    if (DECLINE_RE.test(v)) return opts.findIndex(o => DECLINE_RE.test(o));
    if (v === "yes" || v === "no") return opts.findIndex(o => o === v || o.startsWith(`${v} `) || o.startsWith(`${v},`));
    i = opts.findIndex(o => o.length > 1 && (o.startsWith(v) || v.startsWith(o)));
    if (i >= 0) return i;
    return opts.findIndex(o => o.length > 3 && (o.includes(v) || v.includes(o)));
}

// ---------- filling

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
}

export function isFilled(f: FormField): boolean {
    if (f.kind === "radio") return f.elements.some(e => (e as HTMLInputElement).checked);
    if (f.kind === "checkbox") return (f.elements[0] as HTMLInputElement).checked;
    if (f.kind === "file") return ((f.elements[0] as HTMLInputElement).files?.length ?? 0) > 0;
    if (f.kind === "select") {
        const s = f.elements[0] as HTMLSelectElement;
        return s.selectedIndex > 0 || (s.selectedIndex === 0 && f.options.length === s.options.length && s.value !== "");
    }
    return (f.elements[0] as HTMLInputElement).value.trim() !== "";
}

export type FillMark = "filled" | "ai";

export function markField(f: FormField, mark: FillMark) {
    const el = (f.kind === "radio" ? f.elements[0]?.closest("fieldset, [role='radiogroup']") ?? f.elements[0] : f.elements[0]) as HTMLElement | undefined;
    if (!el) return;
    el.style.outline = mark === "ai" ? "2px dashed #1a6e38" : "2px solid #1a6e38";
    el.style.outlineOffset = "2px";
    el.setAttribute("data-quikresume", mark);
    if (mark === "ai") el.title = "Drafted by quikResume AI. Please review before applying.";
}

/** Fills one field. Returns false when the value has no place in it (no matching option, empty value). */
export function fillField(f: FormField, value: string): boolean {
    if (!value) return false;
    if (f.kind === "radio") {
        const i = matchOption(f.options, value);
        const r = i >= 0 ? (f.elements[i] as HTMLInputElement) : null;
        if (!r) return false;
        r.click();
        if (!r.checked) { r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); }
        return true;
    }
    if (f.kind === "select") {
        const s = f.elements[0] as HTMLSelectElement;
        const all = Array.from(s.options).map(o => o.text.trim());
        const i = matchOption(all, value);
        if (i < 0) return false;
        setNativeValue(s, s.options[i]!.value);
        return true;
    }
    if (f.kind === "checkbox" || f.kind === "file") return false;
    let v = value;
    if (f.kind === "date" && !/^\d{4}-\d{2}(-\d{2})?$/.test(v)) return false;
    if (f.maxLength) v = v.slice(0, f.maxLength);
    setNativeValue(f.elements[0] as HTMLInputElement, v);
    return true;
}

/** Attach a PDF to a file input (DataTransfer works on file inputs Chrome lets scripts set). */
export function attachFile(f: FormField, bytes: Uint8Array<ArrayBuffer>, fileName: string): boolean {
    const input = f.elements[0] as HTMLInputElement;
    try {
        const dt = new DataTransfer();
        dt.items.add(new File([bytes], fileName, { type: "application/pdf" }));
        input.files = dt.files;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return (input.files?.length ?? 0) > 0;
    } catch {
        return false;
    }
}
