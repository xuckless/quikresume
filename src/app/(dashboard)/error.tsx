"use client";

// Error boundary for the signed-in pages: a failed server render or an action that throws during render
// lands here instead of a blank page. The shell (sidebar) stays usable around it.

import React from "react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/primitives/empty-state";
import { Button } from "@/components/ui/primitives/button";
import { X } from "@/components/ui/primitives/icons";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    return (
        <main className="p-4 pb-16 md:p-6">
            <div className="mx-auto max-w-5xl">
                <EmptyState
                    icon={X}
                    title="Something went wrong"
                    body={error.message && !error.digest ? error.message : "This page could not be loaded. Your saved data is safe; try again in a moment."}
                    actions={
                        <>
                            <Button variant="primary" onClick={reset}>Try again</Button>
                            <Link href="/dashboard" className="press inline-flex h-9 items-center rounded-md border border-border bg-surface px-3.5 text-sm font-medium text-fg hover:bg-surface-hover">
                                Back to library
                            </Link>
                        </>
                    }
                />
            </div>
        </main>
    );
}
