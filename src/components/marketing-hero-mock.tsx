// Static product sketch for the landing page hero: a library list next to a résumé page.
// Pure markup (tokens only), decorative, so it is aria-hidden and needs no image asset.

import React from "react";

const ROWS = [
    { title: "Senior Software Engineer", sub: "Northwind", on: true, tags: ["TypeScript", "AWS"] },
    { title: "Software Engineer", sub: "Contoso", on: true, tags: ["Go", "Kubernetes"] },
    { title: "Support Ticket Classifier", sub: "PyTorch, FastAPI", on: true, tags: ["Machine Learning"] },
    { title: "Barista", sub: "Blue Bottle", on: false, tags: [] },
];

function Line({ w, strong }: { w: string; strong?: boolean }) {
    return <div className={strong ? "h-2 rounded-sm bg-fg/70" : "h-1.5 rounded-sm bg-border-strong"} style={{ width: w }} />;
}

export function MarketingHeroMock() {
    return (
        <div aria-hidden className="mt-14 grid w-full gap-4 rounded-lg border border-border bg-surface-muted/60 p-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:p-6">
            <div className="space-y-3">
                <div className="flex items-center gap-2 text-13 font-semibold text-fg">
                    Experience <span className="rounded-sm bg-surface px-1.5 text-xs font-medium text-fg-muted">4</span>
                </div>
                <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
                    {ROWS.map(r => (
                        <li key={r.title} className="flex items-center gap-3 px-4 py-3">
                            <div className={r.on ? "min-w-0 flex-1" : "min-w-0 flex-1 opacity-60"}>
                                <p className="truncate text-sm font-medium text-fg">{r.title}</p>
                                <p className="truncate text-xs text-fg-muted">{r.sub}</p>
                            </div>
                            <div className="hidden gap-1 sm:flex">
                                {r.tags.map(t => <span key={t} className="rounded-sm bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-fg-muted">{t}</span>)}
                            </div>
                            <span className={r.on ? "relative h-[18px] w-8 rounded-full border border-accent bg-accent" : "relative h-[18px] w-8 rounded-full border border-border-strong bg-surface-muted"}>
                                <span className={r.on ? "absolute top-1/2 size-3.5 -translate-y-1/2 translate-x-[15px] rounded-full bg-surface" : "absolute top-1/2 size-3.5 -translate-y-1/2 translate-x-[1px] rounded-full bg-surface"} />
                            </span>
                        </li>
                    ))}
                </ul>
            </div>
            <div className="hidden justify-center md:flex">
                <div className="aspect-[210/297] w-full max-w-xs space-y-4 rounded-sm border border-border bg-paper p-6 shadow-sm">
                    <div className="space-y-1.5"><Line w="55%" strong /><Line w="80%" /></div>
                    {[0, 1, 2].map(i => (
                        <div key={i} className="space-y-1.5">
                            <Line w="35%" strong />
                            <Line w="92%" /><Line w="86%" /><Line w="70%" />
                        </div>
                    ))}
                    <div className="space-y-1.5"><Line w="30%" strong /><Line w="75%" /></div>
                </div>
            </div>
        </div>
    );
}
