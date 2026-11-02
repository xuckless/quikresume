// src/app/(dashboard)/dashboard/extension/page.tsx
import { requireUid } from "@/lib/db/session";
import { listDevices } from "@/lib/ext/tokens";
import { TopBar } from "@/components/ui/primitives/top-bar";
import { ExtensionPanel } from "@/components/ui/extension/extension-panel";

export default async function ExtensionPage({ searchParams }: { searchParams: Promise<{ connect?: string }> }) {
    const uid = await requireUid();
    const [devices, params] = await Promise.all([listDevices(uid), searchParams]);
    return (
        <>
            <TopBar title="Browser extension" subtitle="Save jobs in one click, see your match on any posting, and fill applications." />
            <main className="p-4 pb-16 md:p-6">
                <div className="mx-auto max-w-3xl">
                    <ExtensionPanel devices={devices} autoConnect={params.connect === "1"} />
                </div>
            </main>
        </>
    );
}
