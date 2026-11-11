// "Classic" résumé template — traditional, single column, serif.
//
// Centred name and contact line, small-caps section headings over a full-width rule, bold titles
// with right-aligned dates and an italic organisation line. Conservative enough for law, finance,
// academia and executive roles, and fully ATS-readable (one column, no graphics, real text).
//
// Same data contract as ledger.typ (see src/lib/typst/doc.ts). Entry point: `render(data)`.
// Defaults: Libertinus Serif, near-black accent; both overridable through data.layout.theme.

#import "/lib/theme.typ": resolve, opt, join-present, as-url, url-label, contact-links, stack-entries, page-settings, section-spacing, section-order, heading-for

#let ink = rgb("#1b1b1b")
#let muted = rgb("#4a4a4a")

#let section(title, body, sp, accent, hfont) = {
  if body == none { return }
  v(sp.above * 1pt)
  block(breakable: false, sticky: true, below: 5pt, {
    text(font: hfont, size: 1.08em, weight: "semibold", fill: accent, smallcaps(title))
    v(-7pt)
    line(length: 100%, stroke: 0.6pt + accent)
  })
  if sp.indent > 0 { pad(x: sp.indent * 1pt, body) } else { body }
  v(sp.below * 1pt)
}

// Bold title + right date; optional italic second line (organisation · place).
#let entry(title, org: "", date: "", keep: true, body) = block(breakable: not keep, {
  grid(
    columns: (1fr, auto), column-gutter: 12pt,
    text(weight: "semibold", title),
    text(fill: muted, date),
  )
  if opt(org) { v(-3pt); text(style: "italic", fill: muted, org) }
  if body != none { v(1pt); body }
})

#let bullets(items) = if items.len() > 0 { list(..items) }

#let header(hd) = {
  align(center, {
    text(size: 2.1em, weight: "semibold", tracking: 0.02em, hd.name)
    if opt(hd.tagline) { linebreak(); text(fill: muted, style: "italic", hd.tagline) }
    let parts = (hd.location, hd.phone).filter(opt)
    if opt(hd.email) { parts.push(link("mailto:" + hd.email)[#hd.email]) }
    parts += contact-links(hd)
    if parts.len() > 0 { linebreak(); v(2pt); text(size: 0.92em, parts.map(box).join([ #h(4pt)|#h(4pt) ])) }
  })
  v(4pt)
}

#let render(data) = {
  let pg = page-settings(data)
  let th = resolve(data, accent: rgb("#1b1b1b"), heading-font: "Libertinus Serif", body-font: "Libertinus Serif")
  set page(paper: th.paper, margin: pg.margin * 1mm)
  set text(font: th.body-font, size: (pg.size + 0.5) * 1pt, fill: ink)
  set par(leading: pg.leading * 1em, justify: false)
  show link: set text(fill: ink)
  set list(indent: 6pt, body-indent: 6pt, marker: [•])

  let sections = (
    summary: ("Summary", sp => if opt(data.summary) { par(data.summary) }),
    education: ("Education", sp => if data.education.len() > 0 {
      stack-entries(sp: sp, data.education, (e, keep) => {
        let facts = join-present((
          if opt(e.gpa) { "GPA " + e.gpa } else { "" },
          if opt(e.minor) { "Minor in " + e.minor } else { "" },
        ), "; ")
        entry(e.institution, org: e.title, date: e.date, keep: keep, {
          if opt(facts) or opt(e.details) { text(fill: muted, join-present((facts, e.details), ". ")) }
        })
      })
    }),
    skills: ("Skills", sp => if data.skills.len() > 0 {
      data.skills.map(s => if s.label == "" { [#s.value] } else { [#text(weight: "semibold", s.label): #s.value] }).join(linebreak())
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
    volunteering: ("Leadership & Service", sp => {
      let items = data.at("volunteering", default: ())
      if items.len() > 0 { stack-entries(sp: sp, items, (v, keep) => entry(v.title, org: v.organization, date: v.date, keep: keep, bullets(v.bullets))) }
    }),
    publications: ("Publications", sp => {
      let items = data.at("publications", default: ())
      if items.len() > 0 {
        stack-entries(sp: sp, items, (p, keep) => {
          let title = if opt(p.link) { link(as-url(p.link))[#p.title] } else { p.title }
          entry(title, org: join-present((p.authors, p.venue), ". "), date: p.date, keep: keep, none)
        })
      }
    }),
    awards: ("Honors & Awards", sp => {
      let items = data.at("awards", default: ())
      if items.len() > 0 {
        stack-entries(sp: sp, items, (a, keep) => entry(a.title, org: a.issuer, date: a.date, keep: keep,
          if opt(a.description) { text(fill: muted, a.description) }))
      }
    }),
    certifications: ("Certifications", sp => if data.certifications.len() > 0 {
      block(breakable: false, grid(
        columns: (1fr, auto), column-gutter: 12pt, row-gutter: 4pt,
        ..data.certifications.map(c => ([#c.name#if opt(c.issuer) [, #text(style: "italic", c.issuer)]], text(fill: muted, c.year))).flatten()
      ))
    }),
    languages: ("Languages", sp => {
      let items = data.at("languages", default: ())
      if items.len() > 0 { items.map(l => if opt(l.proficiency) { l.language + " (" + l.proficiency + ")" } else { l.language }).join(", ") }
    }),
  )

  {
    set text(font: th.heading-font)
    header(data.header)
  }
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
