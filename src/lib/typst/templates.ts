// src/lib/typst/templates.ts
// Registry of Typst styling templates. Each entry points at a .typ file under
// public/typst/templates that exports `render(data)`. To add a template:
//   1. write public/typst/templates/<id>.typ exporting `#let render(data) = { ... }`
//   2. import it in public/typst/main.typ and add it to the `templates` dict there
//   3. add an entry here

export const TEMPLATES = {
    ledger: { label: "Ledger", file: "/typst/templates/ledger.typ", blurb: "Airy sans-serif with a soft accent rule. Balanced default." },
    classic: { label: "Classic", file: "/typst/templates/classic.typ", blurb: "Traditional serif, centred header. Law, finance, academia, executive." },
    modern: { label: "Modern", file: "/typst/templates/modern.typ", blurb: "Clean sans-serif with a date column and accent headings." },
    compact: { label: "Compact", file: "/typst/templates/compact.typ", blurb: "Dense and tight. Fits more on one page." },
} as const;

/** Shared Typst modules every template imports (registered with the browser compiler at their root path). */
export const TYPST_LIBS = ["/lib/theme.typ"] as const;

export type TemplateId = keyof typeof TEMPLATES;

export const DEFAULT_TEMPLATE: TemplateId = "ledger";

export function isTemplateId(id: string): id is TemplateId {
    return Object.prototype.hasOwnProperty.call(TEMPLATES, id);
}
