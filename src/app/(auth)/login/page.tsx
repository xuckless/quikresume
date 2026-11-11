// src/app/(auth)/login/page.tsx
import type { Metadata } from "next"
import { signIn, signOut, auth, DEV_LOGIN_ENABLED } from "@/auth"
import Image from "next/image"
import { MarketingHeader } from "@/components/marketing-header";

export const metadata: Metadata = {
    title: "Log in",
    description: "Sign in to quikResume with Google to open your résumé library.",
    alternates: { canonical: "/login" },
    robots: { index: false, follow: true },
};

const PRIMARY = "press flex h-10 w-full items-center justify-center gap-3 rounded-md bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover";
const SECONDARY = "press flex h-10 w-full items-center justify-center rounded-md border border-border bg-surface px-4 text-sm font-medium text-fg hover:bg-surface-hover";

export default async function LoginPage() {
    const session = await auth()

    return (
        <div className="flex min-h-dvh flex-col bg-bg text-fg">
            <MarketingHeader session={session} backHome />

            <main className="flex flex-1 items-center justify-center p-6">
                <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-8">
                    {session ? (
                        <div className="flex flex-col items-center gap-6 text-center">
                            <h1 className="text-xl font-semibold tracking-tight">You are signed in</h1>
                            <div className="flex w-full flex-col items-center gap-2 rounded-md bg-surface-muted p-5">
                                {session.user?.image && (
                                    <Image src={session.user.image} alt="" width={48} height={48} className="size-12 rounded-full" />
                                )}
                                <div>
                                    <p className="text-sm font-medium">{session.user?.name}</p>
                                    <p className="text-13 text-fg-muted">{session.user?.email}</p>
                                </div>
                            </div>
                            <div className="flex w-full flex-col gap-2">
                                <a href="/dashboard" className={PRIMARY}>Go to dashboard</a>
                                <form action={async () => { "use server"; await signOut({ redirectTo: "/login" }) }}>
                                    <button className={SECONDARY}>Sign out</button>
                                </form>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-6 text-center">
                            <div>
                                <h1 className="text-xl font-semibold tracking-tight">Welcome</h1>
                                <p className="mt-1 text-13 text-fg-muted">Sign in to continue to quikResume.</p>
                            </div>
                            <form action={async () => { "use server"; await signIn("google", { redirectTo: "/dashboard" }) }} className="w-full">
                                <button className={SECONDARY}>
                                    <svg className="mr-2.5 size-4" viewBox="0 0 24 24" aria-hidden>
                                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                                    </svg>
                                    Continue with Google
                                </button>
                            </form>
                            {DEV_LOGIN_ENABLED && (
                                <form action={async () => { "use server"; if (DEV_LOGIN_ENABLED) await signIn("dev-login", { redirectTo: "/dashboard" }) }} className="w-full">
                                    <button className={SECONDARY}>Dev login (fake account)</button>
                                </form>
                            )}
                            <p className="text-xs text-fg-subtle">By signing in, you agree to our Terms of Service and Privacy Policy.</p>
                        </div>
                    )}
                </div>
            </main>

            <footer className="border-t border-border py-6 text-center text-13 text-fg-subtle">
                &copy; {new Date().getFullYear()} quikResume
            </footer>
        </div>
    )
}
