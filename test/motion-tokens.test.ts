import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
    DUR, EASE_IN, EASE_IN_OUT, EASE_OUT, EXIT_RATIO, KNOB_STRETCH, MOTION_PRESETS, SCALE_POP, SCALE_PRESS, STAGGER,
    STAGGER_CAP, rubberBand, staggerDelay,
} from "@/lib/ui/motion";

// The motion system lives twice (globals.css for CSS, lib/ui/motion.ts for JS). These checks keep them identical.
const css = readFileSync(path.resolve(__dirname, "../src/app/globals.css"), "utf8");
const token = (name: string) => {
    const m = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
    if (!m) throw new Error(`--${name} missing from globals.css`);
    return m[1].trim();
};
const kebab = (k: string) => k.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
const bezier = (e: readonly number[]) => `cubic-bezier(${e.join(", ")})`;

describe("motion tokens", () => {
    it("every JS duration is the CSS --dur-* token", () => {
        for (const [k, ms] of Object.entries(DUR)) expect(token(`dur-${kebab(k)}`), k).toBe(`${ms}ms`);
    });

    it("curves, stagger and scales match", () => {
        expect(token("ease-out")).toBe(bezier(EASE_OUT));
        expect(token("ease-in")).toBe(bezier(EASE_IN));
        expect(token("ease-in-out")).toBe(bezier(EASE_IN_OUT));
        expect(token("stagger")).toBe(`${STAGGER}ms`);
        expect(token("scale-press")).toBe(String(SCALE_PRESS));
        expect(token("scale-pop")).toBe(String(SCALE_POP));
        expect(token("knob-stretch")).toBe(String(KNOB_STRETCH));
        expect(css).toContain(`min(var(--i, 0), ${STAGGER_CAP})`);
    });

    it("exits are 20% shorter than their entrances", () => {
        const pairs: [number, number][] = [[DUR.pop, DUR.popExit], [DUR.swap, DUR.swapExit], [DUR.reveal, DUR.revealExit], [DUR.drawer, DUR.drawerExit]];
        for (const [enter, exit] of pairs) expect(exit).toBeCloseTo(enter * EXIT_RATIO, 5);
    });

    it("popovers stay within 150-250 ms and nothing springs", () => {
        expect(DUR.pop).toBeGreaterThanOrEqual(150);
        expect(DUR.pop).toBeLessThanOrEqual(250);
        for (const t of Object.values(MOTION_PRESETS)) expect((t as { type?: string }).type).not.toBe("spring");
    });

    it("stagger delay caps like the CSS", () => {
        expect(staggerDelay(0)).toBe(0);
        expect(staggerDelay(2)).toBeCloseTo(0.06, 5);
        expect(staggerDelay(100)).toBeCloseTo((STAGGER_CAP * STAGGER) / 1000, 5);
    });

    it("rubber band gives less the further it goes and never past its range", () => {
        expect(rubberBand(0)).toBe(0);
        expect(rubberBand(-10)).toBe(0);
        const a = rubberBand(20), b = rubberBand(200), c = rubberBand(5000);
        expect(a).toBeGreaterThan(0);
        expect(a).toBeLessThan(20);
        expect(b - a).toBeLessThan(180);
        expect(c).toBeLessThan(120);
    });
});
