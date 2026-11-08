"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export const VIEWS = ["library", "editor", "preview", "import", "jobs"] as const;
export type View = (typeof VIEWS)[number];

export const VIEW_TITLE: Record<View, string> = {
    library: "Library",
    editor: "Master Editor",
    preview: "Preview",
    import: "Import résumé",
    jobs: "Job Tracker",
};

export function parseView(v: string | null | undefined): View {
    // Insights was replaced by the Job Tracker; old links land there.
    if (v === "insights") return "jobs";
    return (VIEWS as readonly string[]).includes(v ?? "") ? (v as View) : "library";
}

export function viewHref(view: View): string {
    return view === "library" ? "/dashboard" : `/dashboard?view=${view}`;
}

/** A job's Match page inside the Tracker (`null` = the board). */
export function jobHref(jobId: string | null): string {
    return jobId ? `/dashboard?view=jobs&job=${encodeURIComponent(jobId)}` : viewHref("jobs");
}

type AppRouter = ReturnType<typeof useRouter>;

/**
 * Navigates to `href`. Moves between views of /dashboard (`?view=`, `?job=`) are client-only: the page already
 * holds all its data, so they update the URL through the History API (Next keeps useSearchParams in sync and
 * Back / Forward work) instead of re-rendering the server page, which re-reads the whole library. Anything else
 * goes through the router.
 */
export function navigateDashboard(router: AppRouter, href: string, opts?: { replace?: boolean }): void {
    if (typeof window !== "undefined" && window.location.pathname === "/dashboard" && new URL(href, window.location.origin).pathname === "/dashboard") {
        if (opts?.replace) window.history.replaceState(null, "", href);
        else window.history.pushState(null, "", href);
        return;
    }
    if (opts?.replace) router.replace(href, { scroll: false });
    else router.push(href, { scroll: false });
}

/** The dashboard view, read from `?view=` and written as a history entry (so Back works). */
export function useDashboardView(): [View, (view: View, opts?: { replace?: boolean }) => void] {
    const params = useSearchParams();
    const pathname = usePathname();
    const router = useRouter();
    const view = pathname === "/dashboard" ? parseView(params.get("view")) : "library";
    const setView = (next: View, opts?: { replace?: boolean }) => navigateDashboard(router, viewHref(next), opts);
    return [view, setView];
}
