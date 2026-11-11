// Header for the public pages (landing, login). The signed-in app uses the sidebar shell.
import Link from "next/link";
import { Wordmark } from "@/components/brand";
import type { Session } from "next-auth";

const BTN = "press inline-flex h-9 items-center justify-center rounded-md px-3.5 text-sm font-medium";

export function MarketingHeader({ session, backHome = false }: { session: Session | null; backHome?: boolean }) {
    return (
        <header className="border-b border-border bg-surface">
            <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6">
                <Link href="/" className="flex items-center gap-2">
                    <Wordmark className="text-[18px]" />
                </Link>
                <nav className="flex items-center gap-2">
                    {session ? (
                        // Plain <a>: entering the signed-in area must be a full page load so its CSP (Typst wasm) applies.
                        <a href="/dashboard" className={`${BTN} bg-accent text-accent-fg hover:bg-accent-hover`}>Dashboard</a>
                    ) : backHome ? (
                        <Link href="/" className={`${BTN} text-fg-muted hover:bg-surface-hover hover:text-fg`}>Back to home</Link>
                    ) : (
                        <>
                            <Link href="/login" className={`${BTN} hidden text-fg-muted hover:bg-surface-hover hover:text-fg sm:inline-flex`}>Log in</Link>
                            <Link href="/start" className={`${BTN} bg-accent text-accent-fg hover:bg-accent-hover`}>Get started</Link>
                        </>
                    )}
                </nav>
            </div>
        </header>
    );
}

export function MarketingFooter() {
    return (
        <footer className="border-t border-border">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-6 py-8 text-13 text-fg-subtle sm:flex-row sm:items-center sm:justify-between">
                <span>
                    &copy; {new Date().getFullYear()} quikResume. All rights reserved.
                    <span className="block text-xs">
                        Skill categories from <a href="https://www.onetcenter.org/database.html" className="underline underline-offset-2 hover:text-fg" rel="noreferrer noopener" target="_blank">O*NET 30.0</a> by the U.S. Department of Labor, ETA, used under CC BY 4.0.
                    </span>
                </span>
                <nav className="flex gap-5">
                    <Link href="/#features" className="hover:text-fg">Features</Link>
                    <Link href="/privacy" className="hover:text-fg">Privacy</Link>
                    <Link href="/login" className="hover:text-fg">Log in</Link>
                </nav>
            </div>
        </footer>
    );
}
