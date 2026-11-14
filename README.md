<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/readme/logo-dark.svg"/>
  <img src="docs/readme/logo-light.svg" alt="quikResume" width="276"/>
</picture>

**One library of everything you've done. A tailored résumé for every job.**

<a href="https://quikresume.vercel.app"><img alt="Live" src="https://img.shields.io/badge/live-quikresume.vercel.app-1a6e38?style=flat-square"/></a> <a href="https://typst.app"><img alt="Typst 0.13 in the browser" src="https://img.shields.io/badge/typst-in_the_browser-171717?style=flat-square"/></a> <a href="https://nextjs.org"><img alt="Next.js 16" src="https://img.shields.io/badge/next.js-16-171717?style=flat-square"/></a> <a href="#license"><img alt="License: showcase only" src="https://img.shields.io/badge/license-showcase_only-1a6e38?style=flat-square"/></a>

[Open the app](https://quikresume.vercel.app) · Chrome extension: Coming Soon · [Guide](docs/GUIDE.md) · [Develop](#develop) · [License](#license)

</div>

## Switch items on, get a résumé

Every role, project, skill and paper you've ever had lives in one library. Toggle what this application needs, and the page re-typesets as you go. The download is a real text PDF, compiled with [Typst](https://typst.app) inside your browser, so applicant tracking systems can read it.

<img src="docs/readme/library.svg" alt="A library of experience rows, each with a switch. Switching off Research Assistant removes it from the typeset résumé page beside the list, and the sections below it move up." width="720"/>

## Match a posting, then tailor to it

Paste a job description and get a score with what's missing. Tailor keeps every item that covers a hard requirement, suggests what to drop, and fits the result to one page. Nothing changes until you accept it. Save it as a variant to get the same résumé back later.

<img src="docs/readme/match.svg" alt="Job Match scores a posting at 84, a strong fit, with its must-have skills. Tailor résumé opens a list of library items; an AI suggestion to exclude an unrelated skills row is accepted and the résumé goes from two pages to one." width="720"/>

## Bring your old résumé

Drop in PDFs, Word files, text or photos, or import your LinkedIn profile through the extension. Each item is marked New, Adds detail or Already in library, so duplicates merge instead of piling up. Nothing is saved until you review it.

<img src="docs/readme/import.svg" alt="A résumé PDF drops into the import card and Analyse résumé runs. The review lists what was found, each item labelled New, Adds detail or Already in library, ready to add to the editor." width="720"/>

## Apply from any job page (Coming Soon)

The Chrome extension saves a posting from LinkedIn, Indeed, Greenhouse, Workday and others, and scores it in a side panel. On the application form, Auto Fill fills in your details, attaches the right PDF, and drafts open questions with AI in a dashed outline. It never submits for you.

<img src="docs/readme/extension.svg" alt="The Chrome extension on a job posting: one click saves it to the Job Tracker and the side panel shows an 84, strong fit, and what would raise it. On the application form, Auto Fill fills the fields, attaches the résumé PDF and drafts an open question with AI in a dashed outline. It never submits." width="720"/>

Also inside: a job tracker board, an AI coach that scores every item, an "About you" brief that steers the advice, four templates with paper, font and accent controls, and layout spacing down to a single entry.

## How it works

<img src="docs/readme/pipeline.svg" alt="The library feeds toTypstDoc, the one place data is shaped, which feeds Typst compiled to WebAssembly in the browser; that produces the live SVG preview and a text PDF. A job posting goes through Job Match and Tailor, which pick the selection in the library." width="720"/>

<details>
<summary>Each part in detail</summary>

| Part | What happens |
| --- | --- |
| **Library** | Firestore (Admin SDK only, client rules deny everything). Each item has `isSelected`, `hidden` lines and tags. A variant stores pointers, never copies. |
| **toTypstDoc()** | The only place data is shaped: order, selection, dates, bullets, layout. Templates get plain strings and only style them. |
| **Typst** | `typst.ts` 0.7 (Typst 0.13) as WebAssembly, loaded when the preview opens. Vendored fonts only, so the preview and the PDF match. |
| **Job Match** | The posting becomes weighted requirements. Evidence comes from tags, Voyage embeddings with a calibrated rerank, and a model judge. The score formula is pure and runs in the browser. |
| **Tailor** | Locks items that cover hard requirements, lets the model flip the rest, then trims to one page. Every change is a suggestion with a reason. |
| **Extension** | WXT + React, Chrome MV3. Pairs with a single-use code; tokens are stored only as hashes and can be revoked. |

</details>

The long tour, the setup tutorial and how your data is handled are in the [guide](docs/GUIDE.md).

## Develop

Needs Node 20+, a Firebase project with a Firestore database named `quikresume`, a Google OAuth client and a Z.ai key. Voyage is optional (without it, Job Match uses tags only).

```sh
npm install            # also copies the Typst wasm and the pdf.js worker into public/
cp .env.example .env.local   # fill in AUTH_*, FIREBASE_*, GLM_API_KEY
npm run dev            # http://localhost:3000
npm test               # vitest, pure modules
npm run lint
```

```sh
cd extension && npm install
WXT_APP_URL=http://localhost:3000 npm run dev
```

- `src/app` routes, server actions and route handlers
- `src/lib` everything that isn't UI: `typst`, `match`, `tags`, `import`, `review`, `security`
- `src/components/ui/primitives` the UI kit
- `public/typst` `main.typ`, the templates and the vendored fonts
- `extension/` the Chrome extension

Conventions, data model and gotchas are in [CLAUDE.md](CLAUDE.md).

## License

[Showcase only](LICENSE). The source is public to read and evaluate. It is not open source: you may not run, deploy, fork into a product or use it commercially. Ask [@xuckless](https://github.com/xuckless) for anything beyond reading.
