// src/lib/security/turnstile.ts
// Cloudflare Turnstile check for signed-out (guest) AI routes. The browser widget
// (NEXT_PUBLIC_TURNSTILE_SITE_KEY) yields a single-use token; the server verifies it with
// TURNSTILE_SECRET_KEY. Unconfigured: allowed outside production (local dev), refused in production
// so guest AI is never open by accident.

import "server-only";

export const isTurnstileConfigured = () => Boolean(process.env.TURNSTILE_SECRET_KEY);

export async function verifyTurnstile(token: string, ip: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const secret = process.env.TURNSTILE_SECRET_KEY;
    if (!secret) {
        return process.env.NODE_ENV === "production"
            ? { ok: false, error: "Trying quikResume without an account is not available right now. Sign in with Google instead." }
            : { ok: true };
    }
    if (!token || token.length > 2048) return { ok: false, error: "Please complete the check and try again." };
    try {
        const body = new URLSearchParams({ secret, response: token });
        if (ip && ip !== "unknown") body.set("remoteip", ip);
        const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body, signal: AbortSignal.timeout(8000) });
        const json = (await res.json()) as { success?: boolean };
        return json.success ? { ok: true } : { ok: false, error: "The check didn't pass. Reload the page and try again." };
    } catch {
        return { ok: false, error: "Couldn't run the check. Try again in a moment." };
    }
}
