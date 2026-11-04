// src/app/privacy/page.tsx: privacy policy (also the Chrome Web Store listing's policy URL).
// Keep it factual: every statement here must match what the code does. Update it with any new processor,
// permission or stored field.
import type { Metadata } from "next";
import { auth } from "@/auth";
import { MarketingFooter, MarketingHeader } from "@/components/marketing-header";
import { SITE_CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
    title: "Privacy",
    description: "What quikResume and its browser extension collect, why, who processes it, and how to delete it.",
    alternates: { canonical: "/privacy" },
};

const CONTACT = SITE_CONTACT_EMAIL;
const UPDATED = "November 3, 2026";

function H({ children }: { children: React.ReactNode }) {
    return <h2 className="mt-10 text-lg font-semibold tracking-tight text-fg">{children}</h2>;
}

export default async function PrivacyPage() {
    const session = await auth();
    return (
        <div className="min-h-dvh bg-bg text-fg">
            <MarketingHeader session={session} />
            <main className="mx-auto w-full max-w-3xl px-6 py-12 text-fg-muted [&_li]:mt-1.5 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
                <h1 className="text-3xl font-semibold tracking-tight text-fg">Privacy</h1>
                <p className="text-13 text-fg-subtle">Last updated {UPDATED}</p>
                <p>quikResume helps you keep your work history in one library, build tailored résumés and match them to jobs. This page explains what we store, why, who processes it on our behalf, and how to delete it. We don&apos;t sell your data, show ads, or share it for anyone else&apos;s marketing.</p>

                <H>What we store when you sign in</H>
                <ul>
                    <li><strong className="text-fg">Your Google account basics</strong>: name, email address and profile picture, from Google sign-in, to identify your account.</li>
                    <li><strong className="text-fg">What you put in your library</strong>: contact details and links, work history, education, skills, projects, certifications, other sections, and the skill tags and coach reviews generated from them.</li>
                    <li><strong className="text-fg">Résumé variants and layout</strong>, <strong className="text-fg">tracked jobs</strong> (posting text, link, status, notes, match results), <strong className="text-fg">About you answers</strong> and <strong className="text-fg">Autofill preferences</strong> (for example address, salary expectations, work authorisation and optional equal-opportunity answers, which default to &quot;Decline to answer&quot;).</li>
                    <li><strong className="text-fg">Usage counters</strong>: per-day counts of AI calls and request rate limits, used to keep the service fair. They expire automatically.</li>
                </ul>

                <H>How AI is used</H>
                <p>To read uploaded résumés, detect skills, analyse job postings, match them to your library, review entries and draft application answers, the relevant text is sent to our AI providers: <strong className="text-fg">Z.ai</strong> (GLM language and vision models) and <strong className="text-fg">Voyage AI</strong> (text embeddings and reranking). They process it to return a result under their own terms. We don&apos;t use your data to train models. AI output can be wrong; you review everything before it&apos;s used.</p>

                <H>Trying it without an account</H>
                <p>On the &quot;Start&quot; page, your draft stays in your browser&apos;s local storage until you sign in or start over. An uploaded résumé and a pasted job are sent to the AI providers above to be read and matched, and are not stored on our servers. To prevent abuse we use <strong className="text-fg">Cloudflare Turnstile</strong> and count requests per visitor using a one-way hash of your IP address; the address itself is not stored. If you sign in afterwards, the draft is added to your new account.</p>

                <H>The browser extension</H>
                <ul>
                    <li>It reads a page only to do what you asked: detect a job posting on supported job sites, save it when you click Save, or fill an application form when you click Auto Fill. Pages on other sites are read only when you click &quot;Scan this page&quot;.</li>
                    <li>Saved postings (title, company, location, link and description) are sent to your quikResume account. Auto Fill reads the labels of form fields on that page, fills empty fields from your profile and preferences, and sends open questions plus the posting to us to draft answers. It never submits a form and never ticks consent boxes.</li>
                    <li>It stores a sign-in token for your account and per-tab state in the browser. Disconnect it from the side panel or from Extension in quikResume at any time; the token is then invalid.</li>
                    <li>The use of information received from Google APIs and from the extension adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.</li>
                </ul>

                <H>Other services we rely on</H>
                <ul>
                    <li><strong className="text-fg">Google Cloud Firestore</strong> (Firebase) stores your account data. <strong className="text-fg">Vercel</strong> hosts the app.</li>
                    <li>When you save a website or GitHub link, we check it still exists: a request to that website, and to the GitHub API for your GitHub username.</li>
                </ul>

                <H>Cookies and local storage</H>
                <p>We use a sign-in session cookie, and local or session storage for preferences such as the theme, open panels and the signed-out draft. No advertising or analytics trackers.</p>

                <H>Keeping and deleting your data</H>
                <p>Your data stays until you delete it. Delete single items at any time, or delete everything from <strong className="text-fg">Profile → Delete account</strong>: this removes your library, variants, jobs, preferences, connected extensions and sign-in link straight away. Usage counters expire on their own within days. You can also download your résumés as PDFs at any time.</p>

                <H>Contact</H>
                <p>{CONTACT ? <>Questions or requests about your data: <a className="text-accent-text underline underline-offset-2" href={`mailto:${CONTACT}`}>{CONTACT}</a>.</> : <>Questions or requests about your data: use the contact address on our Chrome Web Store listing.</>}</p>
            </main>
            <MarketingFooter />
        </div>
    );
}
