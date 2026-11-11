// src/app/(dashboard)/dashboard/extension/page.tsx
import { requireUid } from "@/lib/db/session";
import { listDevices } from "@/lib/ext/tokens";
import { TopBar } from "@/components/ui/primitives/top-bar";
import { ExtensionPanel } from "@/components/ui/extension/extension-panel";

export default async function ExtensionPage({ searchParams }: { searchParams: Promise<{ connect?: string; reason?: string }> }) {
    const uid = await requireUid();
    const [devices, params] = await Promise.all([listDevices(uid), searchParams]);
    return (
        <>
            <TopBar title="Browser extension" subtitle="Save jobs in one click, see your match on any posting, and fill applications." />
            <main className="p-4 pb-16 md:p-6">
                <div className="mx-auto max-w-3xl">
                    {params.reason && <p role="status" className="mb-4 rounded border border-border p-4">{params.reason === "missing" ? "Install the local unpacked Chrome extension first, then connect it here and return to Import from LinkedIn." : "Connect this extension to your current quikResume account, then return to Import from LinkedIn."} Sign in or create your account on this website; no LinkedIn or extension sign-in is needed here.</p>}
                    <ExtensionPanel devices={devices} autoConnect={params.connect === "1"} />
                </div>
            </main>
        </>
    );
}
