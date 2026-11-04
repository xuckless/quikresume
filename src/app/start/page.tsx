// src/app/start/page.tsx: the signed-out onboarding funnel (components/start/start-flow.tsx).
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { MarketingFooter, MarketingHeader } from "@/components/marketing-header";
import { StartFlow } from "@/components/start/start-flow";

export const metadata: Metadata = {
    title: "Start with your résumé",
    description: "Import your résumé, pick a template, paste a job and see your match score. No account needed to try.",
    alternates: { canonical: "/start" },
};

export default async function StartPage() {
    const session = await auth();
    if (session?.user?.id) redirect("/dashboard?view=import");
    return (
        <div className="min-h-dvh bg-bg text-fg">
            <MarketingHeader session={null} />
            <main className="mx-auto w-full max-w-5xl px-6 py-10 md:py-14">
                <StartFlow />
            </main>
            <MarketingFooter />
        </div>
    );
}
