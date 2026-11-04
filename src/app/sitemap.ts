import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Only the public pages: everything under /dashboard needs a session, and /login is noindex.
export default function sitemap(): MetadataRoute.Sitemap {
    return [
        {
            url: `${SITE_URL}/`,
            lastModified: new Date(),
            changeFrequency: "monthly",
            priority: 1,
        },
        { url: `${SITE_URL}/privacy`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
        { url: `${SITE_URL}/start`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
    ];
}
