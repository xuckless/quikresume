// quikResume API client (background worker only). Bearer token in chrome.storage.local; a 401 with
// `unpaired` clears it so the side panel falls back to "Connect".

export class ApiError extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
    }
}

export const appUrl = () => __APP_URL__.replace(/\/$/, "");

export async function getToken(): Promise<string | null> {
    return ((await chrome.storage.local.get("token")).token as string | undefined) ?? null;
}
export const setToken = (token: string) => chrome.storage.local.set({ token });
export const clearToken = () => chrome.storage.local.remove("token");

export async function api<T = unknown>(
    path: string,
    init: { method?: "GET" | "POST" | "PATCH"; body?: unknown; auth?: boolean } = {},
): Promise<T> {
    const headers: Record<string, string> = {};
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    if (init.auth !== false) {
        const token = await getToken();
        if (!token) throw new ApiError("Connect the extension to your quikResume account first.", 401);
        headers.Authorization = `Bearer ${token}`;
    }
    let res: Response;
    try {
        res = await fetch(`${appUrl()}${path}`, {
            method: init.method ?? "GET",
            headers,
            body: init.body === undefined ? undefined : JSON.stringify(init.body),
            credentials: "omit",
        });
    } catch {
        throw new ApiError("Couldn't reach quikResume. Check your connection.", 0);
    }
    const json = (await res.json().catch(() => null)) as ({ ok?: boolean; error?: string; unpaired?: boolean } & T) | null;
    if (res.status === 401 && json?.unpaired) await clearToken();
    if (!res.ok || !json || json.ok === false) {
        throw new ApiError(json?.error ?? (res.status >= 500 ? "quikResume had a problem. Try again in a moment." : `Request failed (${res.status}).`), res.status);
    }
    return json;
}

/** Binary GET (the résumé PDF). */
export async function apiBytes(path: string): Promise<{ bytes: ArrayBuffer; fileName: string }> {
    const token = await getToken();
    if (!token) throw new ApiError("Connect the extension to your quikResume account first.", 401);
    const res = await fetch(`${appUrl()}${path}`, { headers: { Authorization: `Bearer ${token}` }, credentials: "omit" });
    if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new ApiError(json?.error ?? `Request failed (${res.status}).`, res.status);
    }
    const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "resume.pdf";
    return { bytes: await res.arrayBuffer(), fileName: name };
}
