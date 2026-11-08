import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AUTHOR, SITE_DESCRIPTION, SITE_KEYWORDS, SITE_NAME, SITE_TAGLINE, SITE_URL } from "@/lib/site";
import { MotionProvider } from "@/components/motion-provider";
import "./globals.css";

const geistSans = Geist({
    variable: "--font-geist-sans",
    subsets: ["latin"],
});

// Numbers, scores and Typst diagnostics.
const geistMono = Geist_Mono({
    variable: "--font-geist-mono",
    subsets: ["latin"],
});

export const metadata: Metadata = {
    metadataBase: new URL(SITE_URL),
    title: {
        default: `${SITE_NAME} — ${SITE_TAGLINE}`,
        template: `%s — ${SITE_NAME}`,
    },
    description: SITE_DESCRIPTION,
    keywords: SITE_KEYWORDS,
    applicationName: SITE_NAME,
    authors: [{ name: AUTHOR }],
    creator: AUTHOR,
    publisher: AUTHOR,
    alternates: {
        canonical: "/",
    },
    openGraph: {
        type: "website",
        url: "/",
        siteName: SITE_NAME,
        title: `${SITE_NAME} — ${SITE_TAGLINE}`,
        description: SITE_DESCRIPTION,
        locale: "en_US",
    },
    twitter: {
        card: "summary_large_image",
        title: `${SITE_NAME} — ${SITE_TAGLINE}`,
        description: SITE_DESCRIPTION,
    },
    robots: {
        index: true,
        follow: true,
        googleBot: {
            index: true,
            follow: true,
            "max-image-preview": "large",
            "max-snippet": -1,
            "max-video-preview": -1,
        },
    },
    category: "productivity",
    // ?v= busts browser favicon caches (they keep favicons far longer than other assets); bump it when the icons change.
    icons: {
        icon: [
            { url: "/favicon.ico?v=2", sizes: "any" },
            // Switches to the dark monogram with the OS theme (media query inside the SVG).
            { url: "/icons/favicon.svg?v=2", type: "image/svg+xml" },
        ],
        apple: "/icons/apple-touch-icon.png?v=2",
    },
    formatDetection: {
        telephone: false,
    },
};

export const viewport: Viewport = {
    themeColor: [
        { media: "(prefers-color-scheme: light)", color: "#fafafa" },
        { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
    ],
    colorScheme: "light dark",
};

// Runs before first paint: the saved choice (lib/ui/theme-store.ts, "light" | "dark" | "system") or the
// OS preference decides `data-theme`, so the page never flashes the wrong theme. Static string, no user input.
const THEME_SCRIPT = `(function(){try{var k="quikresume.theme",c=localStorage.getItem(k);c=c?JSON.parse(c):"system";var d=c==="dark"||(c!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.setAttribute("data-theme",d?"dark":"light")}catch(e){document.documentElement.setAttribute("data-theme","light")}})()`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
    return (
        // data-theme is set by THEME_SCRIPT before hydration, so React must not warn about the mismatch.
        <html lang="en" suppressHydrationWarning>
            <head>
                <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
            </head>
            <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
                <MotionProvider>{children}</MotionProvider>
            </body>
        </html>
    );
}
