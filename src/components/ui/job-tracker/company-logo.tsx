// src/components/ui/job-tracker/company-logo.tsx
"use client";

// Company icon from /logo/<domain> (see companyDomainOf); a lettered monogram when there is no domain or
// no icon, a briefcase when the company is unknown.

import React, { useState } from "react";
import { cn } from "@/lib/cn";
import { companyDomainOf } from "@/lib/jobs/company-domain";
import { Briefcase } from "@/components/ui/primitives/icons";

export function CompanyLogo({ job, size = 32, className }: { job: { company: string; companyDomain?: string | null; url?: string | null }; size?: number; className?: string }) {
    const domain = companyDomainOf(job);
    const [failed, setFailed] = useState<string | null>(null);
    const box = cn("flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-muted", className);
    const style = { width: size, height: size };
    if (domain && failed !== domain) {
        return (
            <span className={cn(box, "bg-paper")} style={style}>
                {/* eslint-disable-next-line @next/next/no-img-element -- tiny same-origin icon; next/image adds nothing here */}
                <img src={`/logo/${encodeURIComponent(domain)}`} alt="" width={size * 0.62} height={size * 0.62} loading="lazy" onError={() => setFailed(domain)} />
            </span>
        );
    }
    const letter = job.company.trim().match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase();
    return (
        <span className={box} style={style} aria-hidden>
            {letter ? <span className="text-13 font-semibold text-fg-muted">{letter}</span> : <Briefcase className="size-4 text-fg-subtle" />}
        </span>
    );
}
