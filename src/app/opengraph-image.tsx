import { ImageResponse } from "next/og";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";

// Social card for the public pages. Rendered at build/request time by next/og (Satori), so this is
// plain flex layout only - no Tailwind, no CSS variables.
export const alt = `${SITE_NAME} - ${SITE_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
    return new ImageResponse(
        (
            <div
                style={{
                    height: "100%",
                    width: "100%",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    backgroundColor: "#fafafa",
                    color: "#171717",
                    padding: 72,
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                    {/* Brand monogram: the q-bolt on the #003200 rounded square (same paths as components/brand.tsx). */}
                    <svg width="64" height="64" viewBox="0 0 32 32">
                        <rect width="32" height="32" rx="7" fill="#003200" />
                        <g transform="translate(5.38 3.94) scale(0.72)">
                            <circle cx="12.5" cy="12.5" r="7.25" fill="none" stroke="#ffffff" strokeWidth="3.5" />
                            <path fill="#ffffff" d="M18.5 4.5h3.75V18H26l-7.5 12 1.4-8h-3.3l1.9-4z" />
                        </g>
                    </svg>
                    <div style={{ display: "flex", fontSize: 36, fontWeight: 600, letterSpacing: -0.5 }}>
                        <span>quik</span><span style={{ color: "#003200" }}>R</span><span>esume</span>
                    </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                    <div style={{ display: "flex", fontSize: 68, fontWeight: 600, letterSpacing: -1.5, lineHeight: 1.1, maxWidth: 900 }}>
                        {`${SITE_TAGLINE}.`}
                    </div>
                    <div style={{ display: "flex", fontSize: 30, color: "#525252", maxWidth: 860, lineHeight: 1.35 }}>
                        Keep your whole career in one library. Match any job, tailor in a click, apply with autofill.
                    </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 24, color: "#6e6e6e" }}>
                    <div style={{ display: "flex", width: 120, height: 3, backgroundColor: "#1a6e38" }} />
                    <div style={{ display: "flex" }}>Typeset with Typst, compiled in your browser</div>
                </div>
            </div>
        ),
        size,
    );
}
