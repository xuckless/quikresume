"use client";

import React, { useState } from "react";

/**
 * A block that opens and closes in place (an expanded row body, a "Show" table, a disclosure panel).
 *
 * Motion: opening reveals it top-down through a mask while its children settle in 30 ms apart (`settle`);
 * closing runs the mask back bottom-up, ease-in and 20% shorter (`settle-out`), and only then unmounts the
 * children. While closed the wrapper stays in the DOM, `hidden`, so `aria-controls={id}` always resolves.
 * Use it for any `{open && <Body />}`; for whole-view replacement use a crossfade instead.
 */
export function Reveal({ open, id, className, children }: { open: boolean; id?: string; className?: string; children: React.ReactNode }) {
    // The body stays mounted while its exit plays; `closing` is derived, never stored.
    const [rendered, setRendered] = useState(open);
    if (open && !rendered) setRendered(true);
    const closing = !open && rendered;
    const onExitEnd = (e: React.AnimationEvent<HTMLDivElement>) => {
        if (closing && e.target === e.currentTarget && e.animationName === "mask-hide") setRendered(false);
    };
    return (
        <div id={id} hidden={!open && !closing} inert={closing || undefined} className={className}>
            {(open || closing) && <div className={open ? "settle" : "settle-out"} onAnimationEnd={onExitEnd}>{children}</div>}
        </div>
    );
}
