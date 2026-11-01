// src/lib/db/autofill.ts
import "server-only";
import { readMeta, replaceMeta } from "@/lib/db/meta";
import { LIMITS_AUTOFILL, readAutofillPrefs, type AutofillPrefs, type UnmappedField } from "@/lib/autofill/types";

const DOC = "autofill";

export async function readAutofill(uid: string): Promise<AutofillPrefs> {
    return readAutofillPrefs(await readMeta(uid, DOC));
}

export async function writeAutofill(uid: string, prefs: AutofillPrefs): Promise<void> {
    await replaceMeta(uid, DOC, { ...readAutofillPrefs(prefs) });
}

/** Remember fields the extension could not fill (deduped by label + host, newest kept). */
export async function addUnmapped(uid: string, fields: Omit<UnmappedField, "at">[]): Promise<void> {
    if (fields.length === 0) return;
    const prefs = await readAutofill(uid);
    const at = new Date().toISOString();
    const key = (f: { label: string; host: string }) => `${f.label.toLowerCase()}|${f.host}`;
    const answered = new Set(prefs.answers.map(a => a.question.toLowerCase()));
    const fresh = fields.filter(f => !answered.has(f.label.toLowerCase()));
    const merged = new Map(prefs.unmapped.map(f => [key(f), f]));
    for (const f of fresh) merged.set(key(f), { ...f, at });
    prefs.unmapped = [...merged.values()].slice(-LIMITS_AUTOFILL.unmapped);
    await writeAutofill(uid, prefs);
}
