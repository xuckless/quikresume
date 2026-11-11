// "Ledger" résumé template — a pure styling template.
//
// It receives the resume document produced by src/lib/typst/doc.ts
// (see TypstResumeDoc there for the exact shape). Every field is a string
// (possibly empty) or an array; the app has already filtered out unselected
// items, sorted them and pre-formatted date ranges. Templates never see raw
// markup: all user text is displayed as plain strings, so no escaping is needed.
//
// `data.layout` (optional) carries the section order, page settings and
// per-section spacing; every list entry carries space_after / break_before /
// keep. Missing values fall back to the defaults below (the original look).
//
// Exported entry point: `render(data)`.
// Fonts: Inter (vendored in public/typst/fonts). Falls back to Helvetica/Arial.

#import "/lib/theme.typ": resolve, heading-for

// ---------- Tokens ----------
#let ink = rgb("#292b31")
#let muted = rgb("#595d6c")
#let soft = rgb("#3f424d")
#let accent = rgb("#9184d9")
#let accent-deep = rgb("#5d5294")
#let rule = rgb("#cfd3e5")

// ---------- Layout defaults ----------
#let default-order = ("summary", "education", "skills", "projects", "experience", "volunteering", "publications", "awards", "certifications", "languages", "custom")
#let default-page = (margin: 16, size: 10.5, leading: 0.55)
#let default-sp = (above: 4, below: 6, gap: 6, indent: 0)
#let default-item = (space_after: 0, break_before: false, keep: true)

// ---------- Helpers ----------
#let opt(x) = x != none and x != ""

// Joins the non-empty items of `parts` with `sep`.
#let join-present(parts, sep) = parts.filter(opt).join(sep)

// Ensures a URL has a scheme so `link()` produces a clickable target.
#let as-url(s) = if s.starts-with("http://") or s.starts-with("https://") { s } else { "https://" + s }

// Strips the scheme and trailing slash for a compact display label.
#let url-label(s) = {
  let t = s
  for prefix in ("https://", "http://", "www.") {
    if t.starts-with(prefix) { t = t.slice(prefix.len()) }
  }
  t.trim("/", at: end)
}

#let mailto-or-text(email) = link("mailto:" + email)[#email]

// Fading rule: solid at left, transparent at right.
#let fade-rule(color: rule) = box(
  width: 1fr, height: 1pt,
  fill: gradient.linear(color, color.transparentize(100%), angle: 0deg),
)

// Section heading + body. Returns nothing when the body is empty.
// `sp`: (above, below, gap, indent) in pt.
#let section(title, body, sp: default-sp, accent-deep: accent-deep) = {
  if body == none { return }
  v(sp.above * 1pt)
  block(breakable: false, sticky: true, below: 6pt, grid(
    columns: (auto, 1fr), column-gutter: 8pt, align: horizon,
    text(size: 8.5pt, weight: 500, tracking: 0.14em, fill: accent-deep, upper(title)),
    fade-rule(),
  ))
  if sp.indent > 0 { pad(x: sp.indent * 1pt, body) } else { body }
  v(sp.below * 1pt)
}

// Entry with a right-aligned date (education, projects, experience).
// `keep: false` lets a long entry split across pages.
#let entry(title, meta: "", date: "", keep: true, body) = block(breakable: not keep, {
  grid(
    columns: (1fr, auto), column-gutter: 12pt,
    [#text(weight: 500, title)#if opt(meta) [ #text(fill: muted)[· #meta]]],
    text(fill: muted, date),
  )
  if body != none { v(2pt); body }
})

// Two-column label/value list.
#let kv(pairs) = grid(
  columns: (auto, 1fr), column-gutter: 14pt, row-gutter: 4pt,
  ..pairs.map(((k, v)) => (text(fill: muted, weight: 500, k), v)).flatten()
)

#let bullets(items) = if items.len() > 0 { list(..items) }

// Stacks entries with the section's gap between them and applies each entry's
// overrides. `render-one(item, keep)` draws one entry.
#let stack-entries(items, render-one, sp: default-sp) = {
  for (i, item) in items.enumerate() {
    let l = default-item + item
    if l.break_before { pagebreak(weak: true) } else if i > 0 { v(sp.gap * 1pt) }
    render-one(item, l.keep)
    if l.space_after > 0 { v(l.space_after * 1pt) }
  }
}

// ---------- Section macros (one per section) ----------

#let header(h, accent: accent) = {
  let line1 = join-present((h.location, h.phone), " · ")
  let line2 = if opt(h.email) { mailto-or-text(h.email) } else { none }
  let links = ()
  if opt(h.github) { links.push(link(as-url(h.github))[#url-label(h.github)]) }
  if opt(h.linkedin) { links.push(link(as-url(h.linkedin))[#url-label(h.linkedin)]) }
  if opt(h.website) { links.push(link(as-url(h.website))[#url-label(h.website)]) }
  for l in h.at("links", default: ()) {
    if opt(l.url) { links.push(link(as-url(l.url))[#if opt(l.label) [#l.label: #url-label(l.url)] else { url-label(l.url) }]) }
  }
  let contact-lines = ()
  if opt(line1) { contact-lines.push(line1) }
  if line2 != none { contact-lines.push(line2) }
  if links.len() > 0 { contact-lines.push(links.join(" · ")) }

  grid(
    columns: (1fr, auto), column-gutter: 16pt, align: bottom,
    [
      #text(size: 24pt, weight: 500, tracking: -0.01em)[#h.name] \
      #v(-2pt)
      #if opt(h.tagline) { text(fill: muted)[#h.tagline] }
    ],
    align(right, text(size: 9.5pt, fill: soft, contact-lines.join(linebreak()))),
  )
  v(9pt)
  box(width: 100%, height: 1pt, fill: gradient.linear(
    (accent, 0%), (accent, 60%), (accent.transparentize(100%), 100%), angle: 0deg))
  v(8pt)
}

#let summary(s) = if opt(s) { par(s) }

#let education(items, sp) = if items.len() > 0 {
  stack-entries(sp: sp, items, (e, keep) => {
    let facts = join-present((
      if opt(e.gpa) { "GPA " + e.gpa } else { "" },
      if opt(e.minor) { "Minor in " + e.minor } else { "" },
    ), " · ")
    let title = join-present((e.institution, e.title), " — ")
    entry(title, date: e.date, keep: keep, {
      if opt(facts) or opt(e.details) {
        text(fill: muted)[
          #if opt(facts) [#facts #if opt(e.details) [\ ]]
          #if opt(e.details) [#e.details]
        ]
      }
    })
  })
}

#let skills(items, sp) = if items.len() > 0 {
  // An unlabelled row (unnamed category) spans both columns.
  grid(
    columns: (auto, 1fr), column-gutter: 14pt, row-gutter: 4pt,
    ..items.map(i => if i.label == "" { (grid.cell(colspan: 2, i.value),) } else { (text(fill: muted, weight: 500, i.label), i.value) }).flatten()
  )
}

#let projects(items, sp) = if items.len() > 0 {
  stack-entries(sp: sp, items, (p, keep) => {
    let title = if opt(p.link) { link(as-url(p.link))[#p.title] } else { p.title }
    entry(title, meta: p.stack, date: p.date, keep: keep, bullets(p.bullets))
  })
}

#let experience(items, sp) = if items.len() > 0 {
  stack-entries(sp: sp, items, (x, keep) => entry(x.title, meta: x.company, date: x.date, keep: keep, bullets(x.bullets)))
}

#let volunteering(items, sp) = if items.len() > 0 {
  stack-entries(sp: sp, items, (v, keep) => entry(v.title, meta: v.organization, date: v.date, keep: keep, bullets(v.bullets)))
}

#let publications(items, sp) = if items.len() > 0 {
  stack-entries(sp: sp, items, (p, keep) => {
    let title = if opt(p.link) { link(as-url(p.link))[#p.title] } else { p.title }
    let byline = join-present((p.authors, p.venue), " · ")
    entry(title, date: p.date, keep: keep, if opt(byline) { text(fill: muted, byline) })
  })
}

#let awards(items, sp) = if items.len() > 0 {
  stack-entries(sp: sp, items, (a, keep) => entry(a.title, meta: a.issuer, date: a.date, keep: keep,
    if opt(a.description) { text(fill: muted, a.description) }))
}

#let languages(items, sp) = if items.len() > 0 {
  items.map(l => if opt(l.proficiency) { l.language + " (" + l.proficiency + ")" } else { l.language }).join(" · ")
}

#let certifications(items, sp) = if items.len() > 0 {
  block(breakable: false, grid(
    columns: (1fr, auto), column-gutter: 12pt, row-gutter: 4pt,
    ..items.map(c => (
      [#c.name#if opt(c.issuer) [ #text(fill: muted)[· #c.issuer]]],
      text(fill: muted, c.year),
    )).flatten()
  ))
}

// ---------- Entry point ----------
#let render(data) = {
  let layout = data.at("layout", default: (:))
  let pg = default-page + layout.at("page", default: (:))
  let spacing = layout.at("sections", default: (:))
  let sp(key) = default-sp + spacing.at(key, default: (:))

  let th = resolve(data, accent: accent-deep)
  // A custom accent replaces both shades: the deep one for text, a lighter mix for the header rule.
  let deep = th.accent
  let light = if deep == accent-deep { accent } else { deep.lighten(35%) }
  set page(paper: th.paper, margin: pg.margin * 1mm)
  set text(font: th.body-font, size: pg.size * 1pt, fill: ink)
  set par(leading: pg.leading * 1em, justify: false)
  show link: set text(fill: deep)
  set list(indent: 4pt, body-indent: 6pt, marker: text(fill: muted)[•])

  // key -> (heading, body renderer)
  let sections = (
    summary: ("Summary", s => summary(data.summary)),
    education: ("Education", s => education(data.education, s)),
    skills: ("Skills", s => skills(data.skills, s)),
    projects: ("Projects", s => projects(data.projects, s)),
    experience: ("Experience", s => experience(data.experience, s)),
    volunteering: ("Volunteering & Leadership", s => volunteering(data.at("volunteering", default: ()), s)),
    publications: ("Publications", s => publications(data.at("publications", default: ()), s)),
    awards: ("Awards & Honors", s => awards(data.at("awards", default: ()), s)),
    certifications: ("Certifications", s => certifications(data.certifications, s)),
    languages: ("Languages", s => languages(data.at("languages", default: ()), s)),
  )

  {
    set text(font: th.heading-font)
    header(data.header, accent: light)
  }
  for key in layout.at("order", default: default-order) {
    if key in sections {
      let (title, body) = sections.at(key)
      let title = heading-for(data, key, title)
      section(title, body(sp(key)), sp: sp(key), accent-deep: deep)
    } else if key == "custom" {
      // User-named sections: one section per heading, entries styled like volunteering.
      for g in data.at("custom", default: ()) {
        section(g.heading, volunteering(g.entries, sp(key)), sp: sp(key), accent-deep: deep)
      }
    }
  }
}
