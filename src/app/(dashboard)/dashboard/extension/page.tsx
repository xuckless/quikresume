// src/app/(dashboard)/dashboard/extension/page.tsx
import { requireUid } from "@/lib/db/session";
import { listDevices } from "@/lib/ext/tokens";
import { TopBar } from "@/components/ui/primitives/top-bar";
import { ExtensionPanel } from "@/components/ui/extension/extension-panel";
import { NoticeBanner } from "@/components/ui/primitives/notice-banner";
import Link from "next/link";

/** `?reason=` from Import from LinkedIn (lib/import/linkedin-session.ts ExtensionReason). */
const REASON: Record<string, string> = {
    missing: "Install the extension below and connect it, then go back to Import to bring in your LinkedIn profile.",
    pair: "Connect the extension to this account, then go back to Import to bring in your LinkedIn profile.",
    update: "Update the extension (on chrome://extensions, or reinstall it), reload this page, then go back to Import.",
};

export default async function ExtensionPage({ searchParams }: { searchParams: Promise<{ connect?: string; reason?: string }> }) {
    const uid = await requireUid();
    const [devices, params] = await Promise.all([listDevices(uid), searchParams]);
    return (
        <>
            <TopBar title="Browser extension" subtitle="Save jobs in one click, see your match on any posting, and fill applications." />
            <main className="p-4 pb-16 md:p-6">
                <div className="mx-auto max-w-3xl">
                    {params.reason && REASON[params.reason] && (
                        <NoticeBanner tone="warning" className="mb-4">
                            <p>{REASON[params.reason]}</p>
                            <Link href="/dashboard?view=import" className="mt-1 inline-block font-medium underline underline-offset-2">Back to Import</Link>
                        </NoticeBanner>
                    )}
                    <ExtensionPanel devices={devices} autoConnect={params.connect === "1"} />
                </div>
            </main>
        </>
    );
}
