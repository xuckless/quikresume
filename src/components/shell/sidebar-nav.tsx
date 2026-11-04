"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/cn";
import { Wordmark } from "@/components/brand";
import { setTheme, useTheme, type ThemeChoice } from "@/lib/ui/theme-store";
import { parseView, viewHref, type View } from "@/lib/ui/use-dashboard-view";
import { useMediaQuery, XL } from "@/lib/ui/use-media-query";
import { setPreviewPane, togglePreviewPane, usePreviewPane } from "@/lib/ui/preview-pane-store";
import { interceptNavigation } from "@/lib/ui/leave-guard";
import { FOCUS_RING } from "@/components/ui/primitives/button";
import { Monitor, Moon, Sun, Compass, Eye, Layers, Library, ListChecks, LogOut, PenLine, Puzzle, Target, Upload, User, type LucideIcon } from "@/components/ui/primitives/icons";

export interface ShellUser { name: string; email: string; image: string | null }

interface NavItem { label: string; icon: LucideIcon; href: string; view?: View; match: (pathname: string, view: View) => boolean }

// Grouped navigation: building the résumé, finding and tracking jobs, and the account.
// Extension and Autofill preferences join the Jobs / Account groups when those pages ship.
const GROUPS: { label: string; items: NavItem[] }[] = [
    {
        label: "Resume",
        items: [
            { label: "Library", icon: Library, href: viewHref("library"), view: "library", match: (p, v) => p === "/dashboard" && v === "library" },
            { label: "Editor", icon: PenLine, href: viewHref("editor"), view: "editor", match: (p, v) => p === "/dashboard" && v === "editor" },
            { label: "Preview", icon: Eye, href: viewHref("preview"), view: "preview", match: (p, v) => p === "/dashboard" && v === "preview" },
            { label: "Variants", icon: Layers, href: "/dashboard/variants", match: p => p.startsWith("/dashboard/variants") },
            { label: "Import", icon: Upload, href: viewHref("import"), view: "import", match: (p, v) => p === "/dashboard" && v === "import" },
        ],
    },
    {
        label: "Jobs",
        items: [
            { label: "Tracker", icon: Target, href: viewHref("jobs"), view: "jobs", match: (p, v) => p === "/dashboard" && v === "jobs" },
            { label: "Extension", icon: Puzzle, href: "/dashboard/extension", match: p => p.startsWith("/dashboard/extension") },
        ],
    },
    {
        label: "Account",
        items: [
            { label: "About you", icon: Compass, href: "/dashboard/about", match: p => p.startsWith("/dashboard/about") },
            { label: "Autofill preferences", icon: ListChecks, href: "/dashboard/autofill", match: p => p.startsWith("/dashboard/autofill") },
            { label: "Profile", icon: User, href: "/dashboard/profile", match: p => p.startsWith("/dashboard/profile") },
        ],
    },
];

const ITEM = "flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors";
const IDLE = "text-fg-muted hover:bg-surface-hover hover:text-fg";
const ACTIVE = "bg-accent-subtle font-medium text-fg [&>svg]:text-accent-text";

const THEME_OPTIONS: { value: ThemeChoice; label: string; icon: LucideIcon }[] = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "Auto", icon: Monitor },
];

function ThemeToggle() {
    const choice = useTheme();
    return (
        <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-0.5 rounded-md bg-surface-muted p-0.5">
            {THEME_OPTIONS.map(o => {
                const on = choice === o.value;
                const Icon = o.icon;
                return (
                    <button
                        key={o.value}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setTheme(o.value)}
                        className={cn("flex h-7 items-center justify-center gap-1.5 rounded-[5px] text-xs transition-colors", on ? "bg-surface font-medium text-fg shadow-sm" : "text-fg-muted hover:text-fg", FOCUS_RING)}
                    >
                        <Icon className="size-3.5" aria-hidden />{o.label}
                    </button>
                );
            })}
        </div>
    );
}

export function SidebarNav({ user, signOutAction, onNavigate }: { user: ShellUser; signOutAction: () => Promise<void>; onNavigate?: () => void }) {
    const pathname = usePathname();
    const params = useSearchParams();
    const view = pathname === "/dashboard" ? parseView(params.get("view")) : "library";
    const wide = useMediaQuery(XL);
    const paneOpen = usePreviewPane();

    const follow = (href: string) => (e: React.MouseEvent) => {
        if (interceptNavigation(href)) e.preventDefault();
        onNavigate?.();
    };

    const render = (item: NavItem) => {
        const Icon = item.icon;
        // On wide screens "Preview" toggles the side pane instead of navigating. Only the dashboard page draws
        // the pane (it holds the résumé data), so on any other page it opens the pane and goes there.
        if (item.view === "preview" && wide && pathname !== "/dashboard") {
            return (
                <li key={item.label}>
                    <Link href="/dashboard" onClick={e => { setPreviewPane(true); follow("/dashboard")(e); }} className={cn(ITEM, IDLE, FOCUS_RING)}>
                        <Icon className="size-4 shrink-0" aria-hidden />
                        <span className="flex-1">Preview</span>
                    </Link>
                </li>
            );
        }
        if (item.view === "preview" && wide) {
            return (
                <li key={item.label}>
                    <button type="button" onClick={() => { togglePreviewPane(); onNavigate?.(); }} aria-pressed={paneOpen} className={cn(ITEM, "w-full", paneOpen ? ACTIVE : IDLE, FOCUS_RING)}>
                        <Icon className="size-4 shrink-0" aria-hidden />
                        <span className="flex-1 text-left">Preview</span>
                        <span className="text-xs text-fg-subtle">{paneOpen ? "On" : "Off"}</span>
                    </button>
                </li>
            );
        }
        const active = item.match(pathname, view);
        return (
            <li key={item.label}>
                <Link href={item.href} onClick={follow(item.href)} aria-current={active ? "page" : undefined} className={cn(ITEM, active ? ACTIVE : IDLE, FOCUS_RING)}>
                    <Icon className="size-4 shrink-0" aria-hidden />
                    {item.label}
                </Link>
            </li>
        );
    };

    return (
        <div className="flex h-full flex-col">
            <div className="flex h-14 items-center px-4">
                <Link href="/dashboard" onClick={follow("/dashboard")} className={cn("flex items-center gap-2 rounded-md", FOCUS_RING)}>
                    <Wordmark className="text-[17px]" />
                </Link>
            </div>
            <nav className="flex-1 overflow-y-auto px-3 py-2" aria-label="Main">
                {GROUPS.map((g, i) => (
                    <div key={g.label} className={cn(i > 0 && "mt-4")}>
                        <p className="px-2.5 pb-1 text-xs font-medium text-fg-subtle">{g.label}</p>
                        <ul className="space-y-0.5">{g.items.map(render)}</ul>
                    </div>
                ))}
            </nav>
            <div className="border-t border-border px-3 pt-3">
                <ThemeToggle />
            </div>
            <div className="flex items-center gap-2.5 px-4 py-3">
                {user.image ? (
                    <Image src={user.image} alt="" width={28} height={28} className="size-7 shrink-0 rounded-full" />
                ) : (
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-medium text-fg-muted">{(user.name || user.email || "?").slice(0, 1).toUpperCase()}</span>
                )}
                <div className="min-w-0 flex-1 leading-tight">
                    {user.name && <p className="truncate text-13 font-medium text-fg">{user.name}</p>}
                    <p className="truncate text-xs text-fg-subtle">{user.email}</p>
                </div>
                <form action={signOutAction}>
                    <button type="submit" title="Sign out" aria-label="Sign out" className={cn("flex size-8 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg", FOCUS_RING)}>
                        <LogOut className="size-4" aria-hidden />
                    </button>
                </form>
            </div>
        </div>
    );
}
