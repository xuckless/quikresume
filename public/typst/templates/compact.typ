// "Compact" résumé template — dense, built to fit a lot on one page.
//
// Name and contact on one band, small bold uppercase-free headings with a hairline, title ·
// organisation and date on one line, tight bullets, skills as inline "Label: items" lines.
// Spacing from data.layout is honoured but scaled down (SCALE) so "Normal" here is tighter than
// in the other templates; Compact/Relaxed presets still move it in the same direction.
//
// Same data contract as ledger.typ (see src/lib/typst/doc.ts). Entry point: `render(data)`.
// Defaults: IBM Plex Sans, navy accent; overridable through data.layout.theme.

#import "/lib/theme.typ": resolve, opt, join-present, as-url, url-label, contact-links, stack-entries, page-settings, section-spacing, section-order, heading-for

#let ink = rgb("#1a1d21")
#let muted = rgb("#585e68")
#let SCALE = 0.6

#let tight(sp) = (above: sp.above * SCALE, below: sp.below * SCALE, gap: sp.gap * SCALE, indent: sp.indent)

#let section(title, body, sp, accent, hfont) = {
  if body == none { return }
  v(sp.above * 1pt)
  block(breakable: false, sticky: true, below: 3pt, grid(
    columns: (auto, 1fr), column-gutter: 6pt, align: horizon,
    text(font: hfont, size: 1em, weight: "bold", fill: accent, title),
    line(length: 100%, stroke: 0.4pt + accent.lighten(40%)),
  ))
  if sp.indent > 0 { pad(x: sp.indent * 1pt, body) } else { body }
  v(sp.below * 1pt)
}

#let entry(title, org: "", date: "", keep: true, body) = block(breakable: not keep, {
  grid(
    columns: (1fr, auto), column-gutter: 8pt,
    [#text(weight: "semibold", title)#if opt(org) [#text(fill: muted)[ · #org]]],
    text(size: 0.92em, fill: muted, date),
  )
  if body != none { v(-1pt); body }
})

#let bullets(items) = if items.len() > 0 {
  set par(leading: 0.42em)
  list(spacing: 0.42em, ..items)
}

#let header(hd, accent, hfont) = {
  let parts = (hd.location, hd.phone).filter(opt)
  if opt(hd.email) { parts.push(link("mailto:" + hd.email)[#hd.email]) }
  parts += contact-links(hd)
  grid(
    columns: (auto, 1fr), column-gutter: 14pt, align: bottom,
    {
      text(font: hfont, size: 1.9em, weight: "bold", fill: accent, hd.name)
      if opt(hd.tagline) { linebreak(); text(size: 0.95em, fill: muted, hd.tagline) }
    },
    align(right, text(size: 0.88em, fill: muted, parts.map(box).join([ · ]))),
  )
  v(2pt)
  line(length: 100%, stroke: 1pt + accent)
}

#let render(data) = {
  let pg = page-settings(data)
  let th = resolve(data, accent: rgb("#1e3a6e"), heading-font: "IBM Plex Sans", body-font: "IBM Plex Sans")
  set page(paper: th.paper, margin: (pg.margin - 3) * 1mm)
  set text(font: th.body-font, size: (pg.size - 0.75) * 1pt, fill: ink)
  set par(leading: pg.leading * 0.85em, justify: false)
  show link: set text(fill: th.accent)
  set list(indent: 2pt, body-indent: 5pt, marker: text(fill: muted)[•])

  let sections = (
    summary: ("Summary", sp => if opt(data.summary) { par(data.summary) }),
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
      set par(leading: 0.42em)
      data.skills.map(s => [#text(weight: "semibold", s.label): #s.value]).join(linebreak())
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
          entry(title, org: join-present((p.authors, p.venue), " · "), date: p.date, keep: keep, none)
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
      data.certifications.map(c => [#c.name#if opt(c.issuer) [ #text(fill: muted)[(#c.issuer#if opt(c.year) [, #c.year])]]]).join([ · ])
    }),
    languages: ("Languages", sp => {
      let items = data.at("languages", default: ())
      if items.len() > 0 { items.map(l => if opt(l.proficiency) { l.language + " (" + l.proficiency + ")" } else { l.language }).join(" · ") }
    }),
  )

  header(data.header, th.accent, th.heading-font)
  for key in section-order(data) {
    if key in sections {
      let (title, body) = sections.at(key)
      let title = heading-for(data, key, title)
      let sp = tight(section-spacing(data, key))
      section(title, body(sp), sp, th.accent, th.heading-font)
    } else if key == "custom" {
      // User-named sections: one section per heading, entries styled like volunteering.
      let sp = tight(section-spacing(data, key))
      for g in data.at("custom", default: ()) {
        let body = if g.entries.len() > 0 { stack-entries(sp: sp, g.entries, (v, keep) => entry(v.title, org: v.organization, date: v.date, keep: keep, bullets(v.bullets))) }
        section(g.heading, body, sp, th.accent, th.heading-font)
      }
    }
  }
}
