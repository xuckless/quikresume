// src/app/(dashboard)/dashboard/autofill/page.tsx
import { requireUid } from "@/lib/db/session";
import { readAutofill } from "@/lib/db/autofill";
import { readCharacterizationDoc } from "@/lib/db/characterization";
import { TopBar } from "@/components/ui/primitives/top-bar";
import { AutofillForm } from "@/components/ui/autofill/autofill-form";
import type { AutofillPrefs } from "@/lib/autofill/types";

export default async function AutofillPage() {
    const uid = await requireUid();
    const [prefs, about] = await Promise.all([readAutofill(uid), readCharacterizationDoc(uid)]);
    // Empty answers fall back to what About you already says (shown as suggestions until saved).
    const a = about.answers;
    const initial: AutofillPrefs = {
        ...prefs,
        workAuthorized: prefs.workAuthorized || (a.workAuthorization === "authorized" ? "yes" : ""),
        needsSponsorship: prefs.needsSponsorship || (a.workAuthorization === "needs-sponsorship" ? "yes" : a.workAuthorization === "authorized" ? "no" : ""),
        willingToRelocate: prefs.willingToRelocate || (a.relocation === "yes" ? "yes" : a.relocation === "no" ? "no" : ""),
    };
    return (
        <>
            <TopBar title="Autofill preferences" subtitle="What application forms ask that your résumé doesn't say. The extension uses these when you click Auto Fill." />
            <main className="p-4 pb-16 md:p-6">
                <div className="mx-auto max-w-3xl">
                    <AutofillForm initial={initial} />
                </div>
            </main>
        </>
    );
}
