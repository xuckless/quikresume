// Single source of truth for the public-facing site identity (metadata, sitemap, robots, OG image).
// Override the origin per deployment with NEXT_PUBLIC_SITE_URL (no trailing slash).

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://quikresume.vercel.app").replace(/\/$/, "");

export const SITE_NAME = "quikResume";

/** Privacy / data requests (privacy page). Override per deployment with NEXT_PUBLIC_CONTACT_EMAIL. */
export const SITE_CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "xuckless@gmail.com";

export const SITE_TAGLINE = "A résumé for every application, from one library";

export const SITE_DESCRIPTION =
    "Keep your whole professional history in one library, toggle what each application shows, " +
    "and download a real text-based PDF typeset with Typst. Paste a job description to see which " +
    "requirements you cover and which keywords are missing.";

export const SITE_KEYWORDS = [
    "resume builder",
    "résumé builder",
    "ATS resume",
    "tailored resume",
    "job description match",
    "resume keywords",
    "PDF resume",
    "Typst resume",
    "CV builder",
    "resume templates",
];

export const AUTHOR = "xuckless";
