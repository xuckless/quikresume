"use client";

import React from "react";
import { expansion, useExpandedIds } from "@/lib/ui/expansion-store";
import { SectionHeader } from "@/components/ui/primitives/card";
import { Button } from "@/components/ui/primitives/button";
import type { LucideIcon } from "@/components/ui/primitives/icons";

export function LibrarySection({ icon, title, ids, handle, headerActions, collapsed, rowRef, style, children }: {
    icon: LucideIcon;
    title: string;
    ids: string[];
    /** Drag handle for reordering sections. */
    handle?: React.ReactNode;
    headerActions?: React.ReactNode;
    /** Only the header is shown (while sections are being dragged). */
    collapsed?: boolean;
    rowRef?: React.Ref<HTMLElement>;
    style?: React.CSSProperties;
    children: React.ReactNode;
}) {
    const expanded = useExpandedIds();
    const allOpen = ids.length > 0 && ids.every(id => expanded.has(id));
    return (
        <section ref={rowRef} style={style} className="space-y-2 bg-bg">
            <div className="flex items-center gap-1">
                {handle}
                <SectionHeader
                    className="min-w-0 flex-1"
                    icon={icon}
                    title={title}
                    count={ids.length}
                    action={
                        <>
                            {headerActions}
                            <Button size="sm" variant="ghost" onClick={() => (allOpen ? expansion.collapse(ids) : expansion.expand(ids))}>
                                {allOpen ? "Collapse all" : "Expand all"}
                            </Button>
                        </>
                    }
                />
            </div>
            {!collapsed && <ul className="stagger-children divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">{children}</ul>}
        </section>
    );
}
