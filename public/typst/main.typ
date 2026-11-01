// public/typst/main.typ — entry point for both the browser (typst.ts) and the CLI.
//
// The app passes the resume as JSON in `sys.inputs.resume` and the template id
// in `sys.inputs.template`. When run from the CLI without inputs it falls back
// to sample.json so the templates can be iterated on locally:
//
//   typst compile --root public/typst --font-path public/typst/fonts \
//     --ignore-system-fonts public/typst/main.typ .typst-out/sample.pdf
//
// To add a template: import it here and add it to the `templates` dictionary,
// then register it in src/lib/typst/templates.ts.

#import "templates/ledger.typ" as ledger
#import "templates/classic.typ" as classic
#import "templates/modern.typ" as modern
#import "templates/compact.typ" as compact

#let templates = (
  ledger: ledger.render,
  classic: classic.render,
  modern: modern.render,
  compact: compact.render,
)

#let raw-input = sys.inputs.at("resume", default: none)
#let data = if raw-input == none { json("sample.json") } else { json(bytes(raw-input)) }
#let template-id = sys.inputs.at("template", default: "ledger")
#let template-id = if template-id in templates { template-id } else { "ledger" }

#(templates.at(template-id))(data)
