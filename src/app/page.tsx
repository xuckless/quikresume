import React from "react";
import Link from "next/link";
import { auth } from "@/auth";
import { MarketingFooter, MarketingHeader } from "@/components/marketing-header";
import { LandingDemo } from "@/components/landing/landing-demo";
import { Upload } from "@/components/ui/primitives/icons";
import { AUTHOR, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";

const PRIMARY = "press inline-flex h-10 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover";
const SECONDARY = "press inline-flex h-10 items-center justify-center rounded-md border border-border bg-surface px-4 text-sm font-medium text-fg hover:bg-surface-hover";

const FEATURES = [
    { title: "One library, many résumés", body: "Keep every role, licence, project and skill in one place. Switch on what each application should show; nothing is retyped." },
    { title: "Match that reads like a recruiter", body: "Paste a posting. See must-haves, the line on your résumé that proves each one, years against what they ask, and exactly what would raise your score." },
    { title: "Real PDFs, four templates", body: "Typst renders a crisp, ATS-readable PDF in your browser. Ledger, Classic, Modern or Compact, with your accent, fonts and paper size." },
    { title: "Job Tracker and browser extension", body: "Save jobs from LinkedIn, Indeed, Glassdoor, Greenhouse, Workday and more in one click, see your match on the posting, and fill applications with Auto Fill." },
    { title: "Built for every field", body: "Nurses, accountants, teachers, electricians and engineers: licences, degrees and trade tickets count the way a hiring manager counts them." },
    { title: "Import in seconds", body: "Drop in an old PDF or Word résumé and it is read straight into your library, duplicates merged." },
];

// Structured data for search results. Keep it to facts the page itself states.
const JSON_LD = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web browser",
    browserRequirements: "Requires JavaScript and WebAssembly",
    inLanguage: "en",
    author: { "@type": "Person", name: AUTHOR },
    featureList: FEATURES.map(f => f.title),
};

export default async function Home({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
    const [session, sp] = await Promise.all([auth(), searchParams]);
    const cta = session ? "/dashboard" : "/login";

    return (
        <div className="min-h-dvh bg-bg text-fg">
            <script
                type="application/ld+json"
                // Static object built above; nothing user-supplied reaches it.
                dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
            />
            <MarketingHeader session={session} />

            {sp.deleted === "1" && !session && (
                <p role="status" className="mx-auto mt-6 w-full max-w-6xl px-6 text-13 text-fg-muted">Your account and everything in it have been deleted.</p>
            )}
            <section className="mx-auto w-full max-w-6xl px-6 pt-16 pb-16 md:pt-24">
                <div className="max-w-2xl">
                    <h1 className="text-4xl font-semibold leading-[1.08] tracking-tight md:text-5xl">
                        A résumé for every application, from one library.
                    </h1>
                    <p className="mt-5 max-w-xl text-base text-fg-muted md:text-lg">
                        Keep your whole history in one place, switch items on and off per job, see how well you match before you apply, and download a real PDF.
                    </p>
                </div>

                {!session ? (
                    <Link
                        href="/start"
                        className="group mt-10 flex flex-col gap-4 rounded-lg border border-border bg-accent-subtle p-6 transition-colors hover:border-accent sm:flex-row sm:items-center sm:justify-between md:p-8"
                    >
                        <span className="flex items-start gap-4">
                            <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg"><Upload className="size-5" aria-hidden /></span>
                            <span>
                                <span className="block text-xl font-semibold tracking-tight text-fg md:text-2xl">Start by importing your résumé</span>
                                <span className="mt-1 block text-fg-muted">Drop in a PDF or Word file, pick a template, paste a job, and see your match score. No account needed to try.</span>
                            </span>
                        </span>
                        <span className={PRIMARY.replace("press ", "") + " shrink-0"}>Import my résumé</span>
                    </Link>
                ) : (
                    <div className="mt-8"><a href="/dashboard" className={PRIMARY}>Go to dashboard</a></div>
                )}

                <LandingDemo />
            </section>

            <section id="features" className="border-t border-border bg-surface">
                <div className="mx-auto grid w-full max-w-6xl gap-x-12 gap-y-10 px-6 py-16 md:grid-cols-3 md:py-20">
                    {FEATURES.map(f => (
                        <div key={f.title} className="border-t border-border pt-5">
                            <h2 className="text-lg font-semibold tracking-tight">{f.title}</h2>
                            <p className="mt-2 text-sm text-fg-muted md:text-base">{f.body}</p>
                        </div>
                    ))}
                </div>
            </section>

            <section className="mx-auto flex w-full max-w-6xl flex-col items-start gap-5 px-6 py-16 md:flex-row md:items-center md:justify-between">
                <div>
                    <h2 className="text-2xl font-semibold tracking-tight">Ready when you are.</h2>
                    <p className="mt-1 text-fg-muted">Sign in with Google. Nothing to install.</p>
                </div>
                <div className="flex gap-3">
                    {!session && <Link href="/start" className={SECONDARY}>Try without an account</Link>}
                    <a href={cta} className={PRIMARY}>{session ? "Open dashboard" : "Create your library"}</a>
                </div>
            </section>

            <MarketingFooter />
        </div>
    );
}
