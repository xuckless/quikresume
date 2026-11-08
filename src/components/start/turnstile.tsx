// src/components/start/turnstile.tsx
"use client";

// Cloudflare Turnstile widget for the signed-out funnel. Tokens are single use: `take()` returns the
// current one and resets the widget for the next request. Without NEXT_PUBLIC_TURNSTILE_SITE_KEY
// (local dev) it renders nothing and `take()` resolves to "" (the server allows that outside production).

import React, { useEffect, useImperativeHandle, useRef, useState } from "react";

// GuestGuard skips Turnstile in local development; don't load a production key there because
// Cloudflare rejects localhost unless it is explicitly configured as an allowed hostname.
const SITE_KEY = process.env.NODE_ENV === "production" ? (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "") : "";
const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
    render: (el: HTMLElement, opts: Record<string, unknown>) => string;
    reset: (id: string) => void;
    getResponse: (id: string) => string | undefined;
}
declare global { interface Window { turnstile?: TurnstileApi } }

let loading: Promise<void> | null = null;
function loadScript(): Promise<void> {
    loading ??= new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = SCRIPT;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => { loading = null; reject(new Error("Turnstile failed to load")); };
        document.head.appendChild(s);
    });
    return loading;
}

export interface TurnstileHandle { take: () => Promise<string> }

export function Turnstile({ ref }: { ref: React.Ref<TurnstileHandle> }) {
    const box = useRef<HTMLDivElement>(null);
    const widget = useRef<string | null>(null);
    const waiters = useRef<((t: string) => void)[]>([]);
    const [error, setError] = useState(false);

    useEffect(() => {
        if (!SITE_KEY) return;
        let cancelled = false;
        loadScript().then(() => {
            if (cancelled || !box.current || !window.turnstile || widget.current) return;
            widget.current = window.turnstile.render(box.current, {
                sitekey: SITE_KEY,
                appearance: "interaction-only",
                callback: (token: string) => { const w = waiters.current; waiters.current = []; w.forEach(f => f(token)); },
            });
        }).catch(() => setError(true));
        return () => { cancelled = true; };
    }, []);

    useImperativeHandle(ref, () => ({
        take: async () => {
            if (!SITE_KEY) return "";
            const api = window.turnstile;
            const id = widget.current;
            const current = api && id ? api.getResponse(id) : undefined;
            const token = current || await new Promise<string>((resolve, reject) => {
                waiters.current.push(resolve);
                setTimeout(() => reject(new Error("The check is taking too long. Reload the page and try again.")), 30_000);
            });
            if (api && id) api.reset(id);
            return token;
        },
    }));

    if (!SITE_KEY) return null;
    return (
        <div>
            <div ref={box} />
            {error && <p className="text-xs text-danger">The bot check couldn&apos;t load. Disable blockers for this page or sign in with Google.</p>}
        </div>
    );
}
