// Auto Fill, injected on demand into every frame of the active tab (side panel "Auto Fill").
// 1. scan the form, 2. fill what the profile / Autofill preferences answer, 3. attach the résumé PDF,
// 4. ask the background for AI drafts of open questions, 5. report back. Never submits.
import { attachFile, classify, fillField, isFilled, markField, scanFields, valueFor, type AutofillData, type FormField } from "../lib/fields";
import type { BgRequest } from "../lib/types";

const send = <T,>(m: BgRequest) => chrome.runtime.sendMessage(m) as Promise<T>;

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
    const bin = atob(b64);
    const out = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

async function run() {
    const fields = scanFields(document);
    if (fields.length === 0) return; // frames without a form stay quiet
    const open = fields.filter(f => !isFilled(f));
    const keyed = open.map(f => ({ f, key: classify(f) }));
    const needPdf = keyed.some(k => k.key === "resume");
    const res = await send<{ ok: boolean; error?: string; data?: AutofillData; pdf?: { base64: string; fileName: string } | null }>({ type: "autofill-data", needPdf });
    if (!res?.ok || !res.data) return;
    const data = res.data;

    let filled = 0;
    let attached: string | null = null;
    const unmapped: string[] = [];
    const questions: FormField[] = [];
    for (const { f, key } of keyed) {
        if (key === null || key === "coverLetter") { if (f.required && f.label) unmapped.push(f.label); continue; }
        if (key === "question") { questions.push(f); continue; }
        if (key === "resume") {
            if (res.pdf && attachFile(f, b64ToBytes(res.pdf.base64), res.pdf.fileName)) { attached = res.pdf.fileName; markField(f, "filled"); }
            else if (f.label) unmapped.push(f.label);
            continue;
        }
        if (fillField(f, valueFor(key, data))) { filled++; markField(f, "filled"); }
        else if (f.label) unmapped.push(f.label);
    }

    let drafted = 0;
    if (questions.length) {
        const ans = await send<{ ok: boolean; answers?: { id: string; value: string; source: "saved" | "ai" }[] }>({
            type: "autofill-answers",
            questions: questions.slice(0, 25).map(q => ({ id: q.id, label: q.label, ...(q.options.length ? { options: q.options } : {}), ...(q.maxLength ? { maxLength: q.maxLength } : {}) })),
        });
        const byId = new Map((ans?.answers ?? []).map(a => [a.id, a]));
        for (const q of questions) {
            const a = byId.get(q.id);
            if (a && fillField(q, a.value)) { markField(q, a.source === "ai" ? "ai" : "filled"); if (a.source === "ai") drafted++; else filled++; }
            else if (q.label) unmapped.push(q.label);
        }
    }
    await send({ type: "autofill-report", filled, drafted, attached, unmapped: [...new Set(unmapped)].slice(0, 30), host: location.hostname });
}

export default defineContentScript({
    registration: "runtime",
    main() {
        void run();
    },
});
