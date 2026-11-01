// src/lib/db/session.ts
// The signed-in user's id, resolved once per request. The dashboard page calls a dozen server
// actions in parallel and each used to decode the session cookie again; React's `cache` makes
// them share one `auth()` call inside a render or action.
//
// `asUser(uid, fn)` runs server code as a user that was authenticated some other way (the browser
// extension's Bearer token, lib/security/ext-guard.ts), so the library getters can be reused. The
// context lives in AsyncLocalStorage: only server code can set it, a client request never can.

import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { cache } from "react";
import { auth } from "@/auth";

const override = new AsyncLocalStorage<string>();

export function asUser<T>(uid: string, fn: () => Promise<T>): Promise<T> {
    return override.run(uid, fn);
}

const sessionUid = cache(async (): Promise<string | null> => {
    const session = await auth();
    return session?.user?.id ?? null;
});

export async function currentUid(): Promise<string | null> {
    return override.getStore() ?? sessionUid();
}

/** For mutations: throws when nobody is signed in. */
export async function requireUid(): Promise<string> {
    const uid = await currentUid();
    if (!uid) throw new Error("Unauthorized");
    return uid;
}
