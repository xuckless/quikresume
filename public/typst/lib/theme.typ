// Shared theme plumbing for all templates.
//
// `data.layout.theme` (from src/lib/typst/doc.ts) carries the user's overrides:
//   template      template id (main.typ dispatches on it)
//   accent        "#rrggbb" or "" (= the template's own accent)
//   heading_font  family name or "" (= the template's own)
//   body_font     family name or ""
//   paper         "a4" | "us-letter"
// Templates call `resolve(data, defaults)` and read the returned dictionary.

#let fallback-fonts = ("Inter", "Helvetica", "Arial")

#let resolve(data, accent: rgb("#000000"), heading-font: "Inter", body-font: "Inter") = {
  let t = data.at("layout", default: (:)).at("theme", default: (:))
  let a = t.at("accent", default: "")
  let hf = t.at("heading_font", default: "")
  let bf = t.at("body_font", default: "")
  (
    accent: if a != "" { rgb(a) } else { accent },
    heading-font: (if hf != "" { hf } else { heading-font },) + fallback-fonts,
    body-font: (if bf != "" { bf } else { body-font },) + fallback-fonts,
    paper: t.at("paper", default: "a4"),
  )
}

// Shared helpers every template needs.
#let opt(x) = x != none and x != ""
#let join-present(parts, sep) = parts.filter(opt).join(sep)
#let as-url(s) = if s.starts-with("http://") or s.starts-with("https://") { s } else { "https://" + s }
#let url-label(s) = {
  let t = s
  for prefix in ("https://", "http://", "www.") {
    if t.starts-with(prefix) { t = t.slice(prefix.len()) }
  }
  t.trim("/", at: end)
}

// Header contact links in display order (non-empty only).
#let contact-links(h) = {
  let out = ()
  for key in ("linkedin", "github", "website") {
    let v = h.at(key, default: "")
    if opt(v) { out.push(link(as-url(v))[#url-label(v)]) }
  }
  out
}

#let default-order = ("summary", "education", "skills", "projects", "experience", "volunteering", "publications", "awards", "certifications", "languages")
#let default-page = (margin: 16, size: 10.5, leading: 0.55)
#let default-sp = (above: 4, below: 6, gap: 6, indent: 0)
#let default-item = (space_after: 0, break_before: false, keep: true)

// Stacks entries with the section's gap and applies each entry's layout overrides.
#let stack-entries(items, render-one, sp: default-sp) = {
  for (i, item) in items.enumerate() {
    let l = default-item + item
    if l.break_before { pagebreak(weak: true) } else if i > 0 { v(sp.gap * 1pt) }
    render-one(item, l.keep)
    if l.space_after > 0 { v(l.space_after * 1pt) }
  }
}

// Page / spacing settings with defaults.
#let page-settings(data) = default-page + data.at("layout", default: (:)).at("page", default: (:))
#let section-spacing(data, key) = default-sp + data.at("layout", default: (:)).at("sections", default: (:)).at(key, default: (:))
// A heading the user renamed for this section (layout.headings), else the template's own.
#let heading-for(data, key, fallback) = {
  let h = data.at("layout", default: (:)).at("headings", default: (:)).at(key, default: "")
  if h == "" { fallback } else { h }
}
#let section-order(data) = data.at("layout", default: (:)).at("order", default: default-order)
