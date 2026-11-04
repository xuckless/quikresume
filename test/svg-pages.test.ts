// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { svgLayout } from "@/lib/typst/pages";

// Two pages the way typst.ts stacks them; `xlink:href` without an xmlns:xlink declaration (and a bare `&`) make
// it invalid XML, which the strict "image/svg+xml" parser rejects.
const SVG = `<svg class="typst-doc" viewBox="0 0 595 1684" width="595" height="1684" xmlns="http://www.w3.org/2000/svg">
<g class="typst-page" transform="translate(0, 0)" data-page-width="595" data-page-height="842"><use xlink:href="#g1"/><text>R&D</text></g>
<g class="typst-page" transform="translate(0, 842)" data-page-width="595" data-page-height="842"><use xlink:href="#g1"/></g>
</svg>`;

describe("svgLayout", () => {
    it("splits a typst.ts SVG that isn't well-formed XML into its pages", () => {
        expect(new DOMParser().parseFromString(SVG, "image/svg+xml").documentElement.nodeName).not.toBe("svg");
        const layout = svgLayout(SVG, 1);
        expect(layout?.width).toBe(595);
        expect(layout?.pages).toEqual([{ y: 0, height: 842, width: 595 }, { y: 842, height: 842, width: 595 }]);
    });
});
