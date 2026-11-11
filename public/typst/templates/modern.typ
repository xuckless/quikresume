// "Modern" résumé template — clean sans-serif with a left date column.
//
// Large name over an accent bar, accent-coloured section headings, and entries laid out as a
// narrow left column (dates) beside the content. Still one reading column for ATS: the date
// column is a grid cell, not a sidebar, so text order stays date -> title -> bullets.
//
// Same data contract as ledger.typ (see src/lib/typst/doc.ts). Entry point: `render(data)`.
// Defaults: Inter, teal accent; overridable through data.layout.theme.

#import "/lib/theme.typ": resolve, opt, join-present, as-url, url-label, contact-links, stack-entries, page-settings, section-spacing, section-order, heading-for

#let ink = rgb("#1f2328")
#let muted = rgb("#5b616b")
#let date-col = 24mm

#let section(title, body, sp, accent, hfont) = {
  if body == none { return }
  v(sp.above * 1pt)
  block(breakable: false, sticky: true, below: 6pt, grid(
    columns: (date-col, 1fr), column-gutter: 10pt, align: horizon,
    box(width: 100%, height: 2pt, fill: accent),
    text(font: hfont, size: 1.12em, weight: "semibold", fill: accent, title),
  ))
  if sp.indent > 0 { pad(x: sp.indent * 1pt, body) } else { body }
  v(sp.below * 1pt)
}

// Date in the left column; title, organisation and body on the right.
#let entry(title, org: "", date: "", keep: true, body) = block(breakable: not keep, grid(
  columns: (date-col, 1fr), column-gutter: 10pt,
  text(size: 0.9em, fill: muted, date),
  {
    text(weight: "semibold", title)
    if opt(org) { text(fill: muted)[ · #org] }
    if body != none { v(1pt); body }
  },
))

// Content without a date, aligned with the entry text.
#let indented(body) = grid(columns: (date-col, 1fr), column-gutter: 10pt, [], body)

#let bullets(items) = if items.len() > 0 { list(..items) }

#let header(hd, accent, hfont) = {
  text(font: hfont, size: 2.4em, weight: "semibold", tracking: -0.015em, hd.name)
  if opt(hd.tagline) { linebreak(); text(size: 1.05em, fill: accent, hd.tagline) }
  v(4pt)
  let parts = (hd.location, hd.phone).filter(opt)
  if opt(hd.email) { parts.push(link("mailto:" + hd.email)[#hd.email]) }
  parts += contact-links(hd)
  if parts.len() > 0 { text(size: 0.9em, fill: muted, parts.map(box).join([#h(6pt)·#h(6pt)])) }
  v(8pt)
}

#let render(data) = {
  let pg = page-settings(data)
  let th = resolve(data, accent: rgb("#0f5f63"), heading-font: "Inter", body-font: "Inter")
  set page(paper: th.paper, margin: pg.margin * 1mm)
  set text(font: th.body-font, size: pg.size * 1pt, fill: ink)
  set par(leading: pg.leading * 1em, justify: false)
  show link: set text(fill: th.accent)
  set list(indent: 0pt, body-indent: 6pt, marker: box(width: 0.42em, height: 0.5em, baseline: 0.02em, polygon(fill: th.accent, (0pt, 0pt), (0.42em, 0.25em), (0pt, 0.5em))))

  let sections = (
    summary: ("Profile", sp => if opt(data.summary) { indented(par(data.summary)) }),
    education: ("Education", sp => if data.education.len() > 0 {
      stack-entries(sp: sp, data.education, (e, keep) => {
        let facts = join-present((
          if opt(e.gpa) { "GPA " + e.gpa } else { "" },
          if opt(e.minor) { "Minor in " + e.minor } else { "" },
          e.details,
        ), " · ")
        entry(e.title, org: e.institution, date: e.date, keep: keep, if opt(facts) { text(fill: muted, facts) })
      })
    }),
    skills: ("Skills", sp => if data.skills.len() > 0 {
      indented(grid(
        columns: (auto, 1fr), column-gutter: 12pt, row-gutter: 4pt,
        ..data.skills.map(s => if s.label == "" { (grid.cell(colspan: 2, s.value),) } else { (text(weight: "semibold", s.label), s.value) }).flatten()
      ))
    }),
    projects: ("Projects", sp => if data.projects.len() > 0 {
      stack-entries(sp: sp, data.projects, (p, keep) => {
        let title = if opt(p.link) { link(as-url(p.link))[#p.title] } else { p.title }
        entry(title, org: p.stack, date: p.date, keep: keep, bullets(p.bullets))
      })
    }),
    experience: ("Experience", sp => if data.experience.len() > 0 {
      stack-entries(sp: sp, data.experience, (x, keep) => entry(x.title, org: x.company, date: x.date, keep: keep, bullets(x.bullets)))
    }),
    volunteering: ("Volunteering & Leadership", sp => {
      let items = data.at("volunteering", default: ())
      if items.len() > 0 { stack-entries(sp: sp, items, (v, keep) => entry(v.title, org: v.organization, date: v.date, keep: keep, bullets(v.bullets))) }
    }),
    publications: ("Publications", sp => {
      let items = data.at("publications", default: ())
      if items.len() > 0 {
        stack-entries(sp: sp, items, (p, keep) => {
          let title = if opt(p.link) { link(as-url(p.link))[#p.title] } else { p.title }
          entry(title, date: p.date, keep: keep, { let b = join-present((p.authors, p.venue), " · "); if opt(b) { text(fill: muted, b) } })
        })
      }
    }),
    awards: ("Awards", sp => {
      let items = data.at("awards", default: ())
      if items.len() > 0 {
        stack-entries(sp: sp, items, (a, keep) => entry(a.title, org: a.issuer, date: a.date, keep: keep,
          if opt(a.description) { text(fill: muted, a.description) }))
      }
    }),
    certifications: ("Certifications", sp => if data.certifications.len() > 0 {
      stack-entries(sp: (gap: 3) + sp, data.certifications, (c, keep) => entry(c.name, org: c.issuer, date: c.year, keep: true, none))
    }),
    languages: ("Languages", sp => {
      let items = data.at("languages", default: ())
      if items.len() > 0 { indented(items.map(l => if opt(l.proficiency) { [#text(weight: "semibold", l.language) #text(fill: muted, l.proficiency)] } else { l.language }).join([#h(10pt)])) }
    }),
  )

  header(data.header, th.accent, th.heading-font)
  for key in section-order(data) {
    if key in sections {
      let (title, body) = sections.at(key)
      let title = heading-for(data, key, title)
      let sp = section-spacing(data, key)
      section(title, body(sp), sp, th.accent, th.heading-font)
    } else if key == "custom" {
      // User-named sections: one section per heading, entries styled like volunteering.
      let sp = section-spacing(data, key)
      for g in data.at("custom", default: ()) {
        let body = if g.entries.len() > 0 { stack-entries(sp: sp, g.entries, (v, keep) => entry(v.title, org: v.organization, date: v.date, keep: keep, bullets(v.bullets))) }
        section(g.heading, body, sp, th.accent, th.heading-font)
      }
    }
  }
}
