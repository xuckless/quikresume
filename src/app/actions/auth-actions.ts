"use server";

import { signIn, signOut } from "@/auth";

export async function signOutAction() {
    await signOut({ redirectTo: "/" });
}

/** Google sign-in from /start: the dashboard then claims the browser-only guest draft (<GuestClaim>). */
export async function signInFromStartAction() {
    await signIn("google", { redirectTo: "/dashboard?view=jobs" });
}
