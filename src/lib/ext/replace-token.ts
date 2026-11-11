// Pure rule for re-pairing: a browser that pairs again sends its previous token, and that token's
// row is replaced instead of a second device being added.

import { createHash } from "node:crypto";

export const isTokenShape = (t: string) => /^qr_[A-Za-z0-9_-]{43}$/.test(t);

/**
 * Token row ids (sha256) to delete when `code`'s user (`uid`) pairs with `replaces`.
 * Only a well-formed token whose row belongs to that same user counts; anything else is ignored,
 * so a pair request can never revoke another user's token.
 */
export function tokenToReplace(replaces: unknown, uid: string, rows: ReadonlyArray<{ id: string; uid: string }>): string | null {
    if (typeof replaces !== "string" || !isTokenShape(replaces)) return null;
    const id = createHash("sha256").update(replaces).digest("hex");
    return rows.some(r => r.id === id && r.uid === uid) ? id : null;
}
