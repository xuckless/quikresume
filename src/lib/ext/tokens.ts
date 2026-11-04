// src/lib/ext/tokens.ts
// Server-only: browser-extension pairing.
//
//   createLinkCode(uid)        8-char one-time code, 10 min, stored only as sha256 in extension_codes/{hash}
//   redeemLinkCode(code, name) transaction: code unused + unexpired -> marked used, long-lived token minted
//   verifyToken(token)         Bearer token -> uid; only sha256 is stored (extension_tokens/{hash})
//   listDevices / revokeDevice / revokeToken
//
// Tokens never expire on their own (the user revokes them on /dashboard/extension); `lastUsedAt` is
// refreshed at most every 10 minutes. Verified tokens are cached in memory for 30 s per instance, so a
// revoke takes effect within 30 s everywhere and at once on the instance that handled it.

import "server-only";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "@/lib/firestore";

const CODE_TTL_MS = 10 * 60_000;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
const CODE_LENGTH = 8;
const TOKEN_PREFIX = "qr_";
const TOUCH_EVERY_MS = 10 * 60_000;
const CACHE_MS = 30_000;
export const MAX_DEVICES = 10;

const codes = () => db.collection("extension_codes");
const tokens = () => db.collection("extension_tokens");
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Codes are typed by hand: accept lowercase, spaces and dashes. */
export const normalizeCode = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
export const isTokenShape = (t: string) => /^qr_[A-Za-z0-9_-]{43}$/.test(t);

export interface ExtensionDevice {
    id: string;
    deviceName: string;
    prefix: string;
    createdAt: string | null;
    lastUsedAt: string | null;
}

export async function createLinkCode(uid: string): Promise<{ code: string; expiresAt: string }> {
    let code = "";
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    const expiresAt = Timestamp.fromMillis(Date.now() + CODE_TTL_MS);
    await codes().doc(sha256(code)).set({ uid, used: false, createdAt: Timestamp.now(), expiresAt });
    return { code, expiresAt: expiresAt.toDate().toISOString() };
}

export type RedeemResult = { ok: true; token: string; uid: string } | { ok: false; error: string };

export async function redeemLinkCode(rawCode: string, deviceName: string): Promise<RedeemResult> {
    const code = normalizeCode(rawCode);
    if (code.length !== CODE_LENGTH) return { ok: false, error: "That code isn't valid." };
    const codeRef = codes().doc(sha256(code));
    const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
    const name = deviceName.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 60) || "Chrome";

    const result = await db.runTransaction(async tx => {
        const snap = await tx.get(codeRef);
        const d = snap.data();
        if (!d || d.used || (d.expiresAt as Timestamp).toMillis() < Date.now()) return { ok: false as const, error: "That code has expired or was already used. Make a new one." };
        const uid = String(d.uid);
        const existing = await tx.get(tokens().where("uid", "==", uid).limit(MAX_DEVICES));
        if (existing.size >= MAX_DEVICES) return { ok: false as const, error: `You already have ${MAX_DEVICES} connected browsers. Disconnect one first.` };
        tx.update(codeRef, { used: true, usedAt: Timestamp.now() });
        const now = Timestamp.now();
        tx.set(tokens().doc(sha256(token)), { uid, deviceName: name, prefix: token.slice(0, 8), createdAt: now, lastUsedAt: now });
        return { ok: true as const, uid };
    });
    return result.ok ? { ok: true, token, uid: result.uid } : result;
}

const cache = new Map<string, { uid: string; id: string; at: number; touched: number }>();

export async function verifyToken(token: string): Promise<{ uid: string; deviceId: string } | null> {
    if (!isTokenShape(token)) return null;
    const id = sha256(token);
    const now = Date.now();
    const hit = cache.get(id);
    if (hit && now - hit.at < CACHE_MS) return { uid: hit.uid, deviceId: id };
    const snap = await tokens().doc(id).get();
    const d = snap.data();
    if (!d) { cache.delete(id); return null; }
    const last = (d.lastUsedAt as Timestamp | undefined)?.toMillis() ?? 0;
    if (now - last > TOUCH_EVERY_MS) await tokens().doc(id).update({ lastUsedAt: Timestamp.now() }).catch(() => {});
    cache.set(id, { uid: String(d.uid), id, at: now, touched: now });
    return { uid: String(d.uid), deviceId: id };
}

export async function listDevices(uid: string): Promise<ExtensionDevice[]> {
    const snap = await tokens().where("uid", "==", uid).limit(MAX_DEVICES * 2).get();
    const iso = (v: unknown) => (v instanceof Timestamp ? v.toDate().toISOString() : null);
    return snap.docs
        .map(doc => ({ id: doc.id, deviceName: String(doc.get("deviceName") ?? "Chrome"), prefix: String(doc.get("prefix") ?? ""), createdAt: iso(doc.get("createdAt")), lastUsedAt: iso(doc.get("lastUsedAt")) }))
        .sort((a, b) => (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? ""));
}

/** Revoke one of the user's devices by id (the token hash). */
export async function revokeDevice(uid: string, id: string): Promise<boolean> {
    if (!/^[0-9a-f]{64}$/.test(id)) return false;
    const ref = tokens().doc(id);
    const snap = await ref.get();
    if (snap.get("uid") !== uid) return false;
    await ref.delete();
    cache.delete(id);
    return true;
}

/** The extension's own sign-out. */
export async function revokeToken(token: string): Promise<void> {
    if (!isTokenShape(token)) return;
    const id = sha256(token);
    cache.delete(id);
    await tokens().doc(id).delete().catch(() => {});
}

/** Account deletion: every token and pending code of the user, plus this instance's verify cache. */
export async function deleteAllExtensionAccess(uid: string): Promise<void> {
    for (const [id, v] of cache) if (v.uid === uid) cache.delete(id);
    for (const col of [tokens(), codes()]) {
        const snap = await col.where("uid", "==", uid).get();
        for (let i = 0; i < snap.docs.length; i += 400) {
            const batch = db.batch();
            for (const d of snap.docs.slice(i, i + 400)) batch.delete(d.ref);
            await batch.commit();
        }
    }
}
