import { describe, expect, it } from "vitest";
import { classify, fillField, isFilled, matchOption, scanFields, valueFor, type AutofillData } from "./fields";

const data: AutofillData = {
    profile: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", phone: "(416) 555-0100", location: "Toronto, ON", linkedin: "https://www.linkedin.com/in/ada",
        github: "", website: "", headline: "", currentTitle: "Registered Nurse", currentCompany: "St. Mary's", school: "U of T", degree: "BScN", graduation: "2019-06", yearsExperience: 6.4 },
    prefs: {
        address: { street: "1 King St", street2: "", city: "Toronto", region: "ON", postalCode: "M5H 1A1", country: "Canada" },
        salary: { min: "80000", target: "95000", currency: "CAD", period: "year" }, noticePeriod: "2 weeks", earliestStart: "2026-12-01",
        workAuthorized: "yes", needsSponsorship: "no", willingToRelocate: "",
        eeo: { gender: "Decline to answer", pronouns: "Decline to answer", ethnicity: "Decline to answer", veteran: "Decline to answer", disability: "Decline to answer", lgbtq: "Decline to answer" },
        howDidYouHear: "Company website",
    },
};

function form(html: string) {
    document.body.innerHTML = html;
    return scanFields(document);
}

describe("scan + classify", () => {
    it("labels inputs from <label for>, wrapping labels, aria-label and fieldset legends", () => {
        const f = form(`
            <label for="fn">First name *</label><input id="fn" name="first_name" required>
            <label>Last Name <input name="ln"></label>
            <input aria-label="Email address" type="email">
            <input name="phone" placeholder="Phone">
            <fieldset><legend>Are you legally authorized to work in Canada?</legend>
              <label><input type="radio" name="auth" value="1"> Yes</label><label><input type="radio" name="auth" value="0"> No</label></fieldset>
            <label for="why">Why do you want to work at St. Mary's?</label><textarea id="why"></textarea>
            <label for="cv">Resume/CV</label><input type="file" id="cv">
            <label for="g">Gender</label><select id="g"><option>Select...</option><option>Female</option><option>Male</option><option>I don't wish to answer</option></select>
            <label><input type="checkbox" name="consent"> I agree to the privacy policy</label>`);
        const byLabel = Object.fromEntries(f.map(x => [x.label, classify(x)]));
        expect(byLabel).toMatchObject({
            "First name *": "firstName", "Last Name": "lastName", "Email address": "email", Phone: "phone",
            "Are you legally authorized to work in Canada?": "workAuthorized", "Why do you want to work at St. Mary's?": "question",
            "Resume/CV": "resume", Gender: "gender", "I agree to the privacy policy": null,
        });
        expect(f.find(x => x.kind === "radio")?.options).toEqual(["Yes", "No"]);
        expect(f.find(x => x.label.startsWith("First"))?.required).toBe(true);
    });
    it("treats a long question as a question even with a fact keyword", () => {
        const [f] = form(`<label for="q">Tell us about a time you worked with a difficult employer and what you learned</label><input id="q">`);
        expect(classify(f!)).toBe("question");
    });
});

describe("fill", () => {
    it("fills text, selects (decline synonyms) and radios (yes/no) without overwriting", () => {
        const f = form(`
            <label for="fn">First name</label><input id="fn">
            <label for="ln">Last name</label><input id="ln" value="Byron">
            <label for="g">Gender</label><select id="g"><option value="">Select...</option><option value="f">Female</option><option value="d">I don't wish to answer</option></select>
            <fieldset><legend>Will you now or in the future require visa sponsorship?</legend>
              <label><input type="radio" name="s" value="y"> Yes</label><label><input type="radio" name="s" value="n"> No</label></fieldset>`);
        let changes = 0;
        document.addEventListener("change", () => changes++);
        for (const x of f) {
            const key = classify(x);
            if (!key || key === "question" || isFilled(x)) continue;
            fillField(x, valueFor(key, data));
        }
        expect((document.getElementById("fn") as HTMLInputElement).value).toBe("Ada");
        expect((document.getElementById("ln") as HTMLInputElement).value).toBe("Byron");
        expect((document.getElementById("g") as HTMLSelectElement).value).toBe("d");
        expect((document.querySelector('input[value="n"]') as HTMLInputElement).checked).toBe(true);
        expect(changes).toBeGreaterThan(0);
    });
    it("matches options loosely", () => {
        expect(matchOption(["Yes, I am authorized", "No"], "Yes")).toBe(0);
        expect(matchOption(["Canada", "United States"], "canada")).toBe(0);
        expect(matchOption(["Female", "Male", "Prefer not to say"], "Decline to answer")).toBe(2);
        expect(matchOption(["A", "B"], "")).toBe(-1);
    });
});
