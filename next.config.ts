import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Content Security Policy. Next.js injects inline scripts for hydration, so 'unsafe-inline' stays on
// script-src until a nonce pipeline exists. Everything is same-origin: fonts are self-hosted by
// next/font, the pdf.js worker and the Typst wasm come from /public, avatars from Google.
//
// The signed-in area gets a looser script-src: the Typst compiler runs as wasm in the browser and its
// wasm-bindgen glue evaluates a string on start-up, so it needs 'unsafe-eval' next to
// 'wasm-unsafe-eval' (without it the preview and the PDF download die with "Refused to evaluate a
// string as JavaScript"). Public pages keep the strict policy. Dev needs 'unsafe-eval' everywhere
// for React Refresh.
const TURNSTILE = "https://challenges.cloudflare.com";

const buildCsp = (scriptSrc: string, extra: { frame?: string; connect?: string } = {}) => [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://lh3.googleusercontent.com",
    "font-src 'self' data:",
    `connect-src 'self' blob: data:${extra.connect ? ` ${extra.connect}` : ""}`,
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "media-src 'self' blob: data:",
    "frame-ancestors 'none'",
    `frame-src ${extra.frame ?? "'none'"}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "manifest-src 'self'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

// The /start flow can be reached through a client-side navigation from any public page. CSP is
// enforced from the original document response during that navigation, so the public policy must
// allow Turnstile too (the /start response still carries the same dedicated policy for direct loads).
const publicCsp = buildCsp(`'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} ${TURNSTILE}`, { frame: TURNSTILE, connect: TURNSTILE });
const appCsp = buildCsp("'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:");
// /start (signed-out funnel): the Typst preview like the dashboard, plus Cloudflare Turnstile.
const startCsp = buildCsp(`'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: ${TURNSTILE}`, { frame: TURNSTILE, connect: TURNSTILE });

const securityHeaders = [
    { key: "Content-Security-Policy", value: publicCsp },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
    { key: "X-DNS-Prefetch-Control", value: "off" },
    ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]),
];

const nextConfig: NextConfig = {
    reactCompiler: true,
    // Router cache for dynamic pages: going back to a signed-in page within 30 s reuses what was rendered
    // instead of re-reading Firestore. Server actions (revalidatePath) and router.refresh() still clear it.
    experimental: { staleTimes: { dynamic: 30 } },
    poweredByHeader: false,
    // Native Typst compiler for server-side PDFs (lib/typst/server-pdf.ts): never bundled, and the
    // templates + fonts it reads from public/typst are traced into the function that uses it.
    serverExternalPackages: ["@myriaddreamin/typst-ts-node-compiler"],
    outputFileTracingIncludes: {
        "/api/ext/resume/pdf": [
            "./public/typst/main.typ", "./public/typst/sample.json", "./public/typst/templates/**", "./public/typst/lib/**", "./public/typst/fonts/**",
        ],
    },
    images: {
        remotePatterns: [
            {
                protocol: 'https',
                hostname: 'lh3.googleusercontent.com',
                pathname: '/a/**',
            },
        ],
    },
    async headers() {
        return [
            { source: "/:path*", headers: securityHeaders },
            // Signed-in area: the Typst engine's CSP (later rules override the same key), and nothing
            // may be cached by a shared cache.
            {
                source: "/dashboard/:path*",
                headers: [
                    { key: "Content-Security-Policy", value: appCsp },
                    { key: "Cache-Control", value: "private, no-store" },
                ],
            },
            { source: "/start", headers: [{ key: "Content-Security-Policy", value: startCsp }, { key: "Cache-Control", value: "private, no-store" }] },
            { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
        ];
    },
};

export default nextConfig;
