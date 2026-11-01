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

/** The dashboard view, read from `?view=` and written with router navigation (so Back works). */
export function useDashboardView(): [View, (view: View, opts?: { replace?: boolean }) => void] {
    const params = useSearchParams();
    const pathname = usePathname();
    const router = useRouter();
    const view = pathname === "/dashboard" ? parseView(params.get("view")) : "library";
    const setView = (next: View, opts?: { replace?: boolean }) => {
        const href = viewHref(next);
        if (opts?.replace) router.replace(href, { scroll: false });
        else router.push(href, { scroll: false });
    };
    return [view, setView];
}
