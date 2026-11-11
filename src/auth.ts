import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import Credentials from "next-auth/providers/credentials"
import { FirestoreAdapter } from "@auth/firebase-adapter"
import { db } from "@/lib/firestore"

// Local testing only: a fixed fake account, never available in a production build.
export const DEV_LOGIN_ENABLED = process.env.NODE_ENV === "development" && process.env.ALLOW_DEV_LOGIN === "1";

const devLogin = Credentials({
    id: "dev-login",
    name: "Dev login",
    credentials: {},
    authorize: () => DEV_LOGIN_ENABLED ? { id: "dev-tester", name: "Dev Tester", email: "dev-tester@example.test" } : null,
});

export const { handlers, auth, signIn, signOut } = NextAuth({
    adapter: FirestoreAdapter(db),
    providers: DEV_LOGIN_ENABLED ? [Google, devLogin] : [Google],
    session: {
        strategy: "jwt",
        // Signed-in for two weeks of inactivity at most; the token is refreshed on use.
        maxAge: 14 * 24 * 60 * 60,
        updateAge: 24 * 60 * 60,
    },
    pages: {
        signIn: "/login",
    },
    callbacks: {
        // This callback injects the ID into the session object
        session({ session, token }) {
            if (token.sub && session.user) {
                session.user.id = token.sub;
            }
            return session;
        },
    },
})
