/** Strict profile-page identity, not proof of ownership. */
export function canonicalProfileUrl(raw: string): string | null {
    try {
        const u = new URL(raw);
        if (u.protocol !== "https:" || !["linkedin.com", "www.linkedin.com"].includes(u.hostname) || u.port || u.username || u.password) return null;
        const m = /^\/in\/([A-Za-z0-9_-]{3,100})\/?$/.exec(u.pathname);
        return m?.[1] ? `https://www.linkedin.com/in/${m[1].toLowerCase()}` : null;
    } catch { return null; }
}
