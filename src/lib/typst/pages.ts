// src/lib/typst/pages.ts
// typst.ts renders every page into one tall SVG (`svg.typst-doc` with one `g.typst-page` per page,
// stacked vertically). The preview shows them as separate sheets: each sheet is a window of the
// same SVG, clipped to one page's box. Browser only (DOMParser).

export interface SvgPageBox {
    /** Top of the page in SVG user units. */
    y: number;
    height: number;
    width: number;
}

export interface SvgLayout {
    width: number;
    height: number;
    pages: SvgPageBox[];
}

function num(v: string | null | undefined): number | null {
    if (v === null || v === undefined) return null;
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
}

function translateY(transform: string | null): number | null {
    if (!transform) return null;
    const m = /translate\(\s*([-\d.e]+)(?:[\s,]+([-\d.e]+))?\s*\)/.exec(transform);
    return m ? num(m[2] ?? "0") : null;
}

/** Page boxes of a typst.ts SVG; falls back to `fallbackPages` equal slices when the markup is unexpected. */
export function svgLayout(svg: string, fallbackPages: number): SvgLayout | null {
    let root: Element | null = null;
    try {
        root = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
    } catch {
        return null;
    }
    if (!root || root.nodeName.toLowerCase() !== "svg") return null;
    const vb = (root.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
    const width = (vb.length === 4 && Number.isFinite(vb[2]) ? vb[2] : null) ?? num(root.getAttribute("data-width")) ?? num(root.getAttribute("width"));
    const height = (vb.length === 4 && Number.isFinite(vb[3]) ? vb[3] : null) ?? num(root.getAttribute("data-height")) ?? num(root.getAttribute("height"));
    if (!width || !height) return null;

    const groups = [...root.querySelectorAll("g.typst-page")];
    const pages: SvgPageBox[] = [];
    for (const g of groups) {
        const y = translateY(g.getAttribute("transform"));
        const h = num(g.getAttribute("data-page-height"));
        const w = num(g.getAttribute("data-page-width")) ?? width;
        if (y === null || !h) { pages.length = 0; break; }
        pages.push({ y, height: h, width: w });
    }
    if (pages.length === 0) {
        const n = Math.max(1, fallbackPages);
        for (let i = 0; i < n; i++) pages.push({ y: (height / n) * i, height: height / n, width });
    }
    return { width, height, pages };
}
