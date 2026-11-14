<div align="center">

<img src="../public/icons/quik-resume.svg" width="44" alt="">

# quikResume guide

### One library of everything you have ever done. A different résumé for every application. A real PDF, typeset in your browser.

[![Next.js 16](https://img.shields.io/badge/Next.js-16.1.6-000?logo=next.js&logoColor=white)](https://nextjs.org)
[![React 19](https://img.shields.io/badge/React-19.2-087ea4?logo=react&logoColor=white)](https://react.dev)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Typst 0.13](https://img.shields.io/badge/Typst-0.13_in_the_browser-239dad)](https://typst.app)
[![Firestore](https://img.shields.io/badge/Firestore-Admin_SDK_only-ffa000?logo=firebase&logoColor=white)](https://firebase.google.com/docs/firestore)
[![License: showcase only](https://img.shields.io/badge/License-showcase_only-dc2626)](../LICENSE)

**[Feature tour](#-the-tour) · [Live walkthrough](#-a-real-application-start-to-finish) · [Setup tutorial](#-tutorial-from-git-clone-to-your-first-pdf) · [Data protection](#-your-data-and-what-happens-to-it) · [Architecture](#-architecture) · [License](#-license--showcase-only)**

### ▶ [Open the interactive tour](https://xuckless.github.io/quikresume/)

<sub>A companion page where the feature tabs, the screenshots and the **fit-score calculator** are live — toggle a requirement and watch the 84 recompute with the app's own formula.</sub>

<img src="media/preview-pane.png" alt="The quikResume library with the live Typst preview docked beside it" width="100%">

<sub>Every screenshot in this guide is the real application, captured from a running instance. All data belongs to **Alex Morgan**, a fictional example user — see [About the example data](#-about-the-example-data).</sub>

</div>

---

## Why this exists

You do not have one résumé. You have a backend-flavoured one, a research-flavoured one, a one-page one for the job board that rejects two pages, and a version where the coffee-shop job is switched off because this application is for a platform team.

Keeping those as five Word files is how you end up sending the wrong one.

quikResume keeps **one** master library — every role, project, skill, paper, award you have ever had — and lets you switch items on and off per application. The résumé is regenerated from the library every time, typeset with [Typst](https://typst.app) compiled to WebAssembly **inside your browser**, so the download is a real text-based PDF that an applicant tracking system can read.

```mermaid
flowchart LR
    A["Master Library<br/>Firestore · 9 collections"] -->|"toggle isSelected"| B["Working selection"]
    B --> C["toTypstDoc()<br/>the JSON contract"]
    C --> D["Typst 0.13 wasm<br/>in the browser"]
    D --> E["SVG preview<br/>live, 300 ms debounce"]
    D --> F["Text PDF<br/>download"]
    B -.->|"snapshot"| G["Variants<br/>pointers only"]
    H["Job description"] --> I["Job Match<br/>score · gaps · ATS check"]
    I -.->|"suggests a selection"| B
    style A fill:#f5f5f5,stroke:#d4d4d4
    style D fill:#e6f7f7,stroke:#239dad
    style F fill:#f0fdf4,stroke:#bbf7d0
    style I fill:#fffbeb,stroke:#fde68a
```

---

## 👤 Meet the example user

Everything below follows one fictional candidate, so you can see the features on real content instead of `Lorem ipsum`.

> ### Alex Morgan
> **B.S. Computer Science, Class of 2026 · Software · AI/ML · Cloud · Data** · Seattle, WA
>
> Two production internships (Go tooling at Northwind Cloud, FastAPI microservices at Contoso Health), a systems-lab research stint that produced a USENIX ATC paper, three projects, an AWS certificate, a hackathon win, a mentoring role — **and a coffee-shop job from before university.**
>
> | Library | Count |
> |---|---|
> | Experience | 4 |
> | Education | 1 |
> | Skill categories | 6 |
> | Projects | 3 |
> | Certifications | 3 |
> | Awards · Volunteering · Publications · Languages | 1 · 1 · 1 · 2 |
> | **Total items** | **22** |
> | Extracted tags | **80** |
> | Saved variants | 3 |
>
> Today Alex is applying for **Backend Engineer, Platform** at Globex Systems.

The same person lives in [`public/typst/sample.json`](../public/typst/sample.json), so you can compile Alex's résumé with the Typst CLI without running the app at all.

---

## 🎬 The tour

Nine things the app does. Each one is stated in plain language, shown as a screenshot, and then followed by a **How it works** panel with the actual mechanism and file paths — click any of them to expand.

<table>
<tr>
<td width="33%"><b>1. <a href="#1-one-library-many-résumés">One library, many résumés</a></b><br/><sub>Toggle items per application</sub></td>
<td width="33%"><b>2. <a href="#2-a-real-pdf-compiled-in-your-browser">A real PDF, in your browser</a></b><br/><sub>Typst wasm, no server render</sub></td>
<td width="33%"><b>3. <a href="#3-job-match--how-well-do-you-actually-fit">Job Match</a></b><br/><sub>Score, gaps, ATS keyword check</sub></td>
</tr>
<tr>
<td><b>4. <a href="#4-tailor--two-pages-to-one-without-losing-the-must-haves">Tailor</a></b><br/><sub>Two pages → one, safely</sub></td>
<td><b>5. <a href="#5-insights--all-your-keywords-in-one-picture">Insights</a></b><br/><sub>Every keyword you carry</sub></td>
<td><b>6. <a href="#6-an-ai-career-coach-on-every-item">AI career coach</a></b><br/><sub>Per-item score and rewrites</sub></td>
</tr>
<tr>
<td><b>7. <a href="#7-import-an-old-résumé-in-one-step">Import</a></b><br/><sub>PDF/DOCX → library</sub></td>
<td><b>8. <a href="#8-about-you--advice-that-fits-your-career-stage">About you</a></b><br/><sub>Advice that fits your stage</sub></td>
<td><b>9. <a href="#9-typographic-control-without-a-word-processor">Layout control</a></b><br/><sub>Spacing, order, page breaks</sub></td>
</tr>
</table>

---

### 1. One library, many résumés

> **Nothing is ever retyped.** Every role, bullet, skill and paper lives in one place. For each application you flip switches: this internship on, the coffee-shop job off, these three bullets yes, that fourth one no. The résumé is rebuilt from what is left.

<img src="media/library.png" alt="The library view: sections with counts, coach scores, date ranges and include switches" width="100%">

Alex's Barista row is dimmed and switched off — it stays in the library for retail applications, but it will not print here. The **Action items** card at the top is the app telling Alex that this one item is dragging the résumé down.

<details>
<summary><b>How it works</b> — <code>isSelected</code>, <code>hidden[]</code>, variants as pointers</summary>

<br/>

**Three levels of granularity**, all stored per item:

| Level | Field | Where it is edited | What it does |
|---|---|---|---|
| Whole item | `isSelected: boolean` | the row switch | keeps the item in the library, off the page |
| One bullet | `hidden: string[]` of `bulletKey` | per-bullet checkboxes | drops that line only |
| One skill | `hidden: string[]` of `skillKey` | skill chips | drops that word from the category |

`bulletKey` is the **whitespace-squashed text of the printed line**, not an index (`src/lib/sub-items.ts`). That is deliberate: reordering bullets can never hide the wrong one, and rewording a hidden line brings it back on purpose. `saveResumeData` runs `pruneHidden(...)` so keys whose text no longer exists are dropped instead of rotting.

**A variant is a snapshot of ids, not of content:**

```ts
// users/{uid}/variants/{id}
{ name: "Backend / platform roles",
  labels: ["backend", "platform", "new grad"],
  items:  { experience: ["exp-northwind", "exp-contoso", "exp-research"],
            skills: ["sk-languages", "sk-cloud", "sk-testing", "sk-web"], /* … */ },
  hidden: { "exp-northwind": ["…bulletKey…"] },
  layout: { /* full ResumeLayout snapshot */ },
  templateId: "ledger" }
```

Because variants hold **pointers**, fixing a typo in one bullet fixes it in all three of Alex's variants at once. The editor knows this: saving an item that variants use raises *"These edits affect saved variants"* first (`src/lib/variants.ts`, `variant-actions.ts`).

**The draft model.** Opening the Master Editor copies server truth into a client `draft`; every other view keeps reading server state, so a stale draft can never hide what Job Match just wrote. The draft is **never** re-derived from props, so a `revalidatePath` refresh mid-edit cannot clobber unsaved work. Deleting a saved item only removes it from the draft and records it in `pendingDeletes` — `Discard` brings it back (`src/components/dashboard-client.tsx`).

**Writes are batched and idempotent.** A new item gets a client-side `tmp-<uuid>` id and is written to document `<uuid>` — not an auto-id — so retrying a save that failed halfway cannot create duplicates. Batches chunk at 450 writes, under Firestore's 500 limit (`src/app/actions/resume-actions.ts`).

</details>

<details>
<summary><b>One row, expanded</b> — per-bullet switches, the coach panel, tags, variant usage</summary>

<br/>

<img src="media/library-row.png" alt="An expanded library row: bullet checkboxes, a coach review, tag chips and the variants using the item" width="100%">

Each bullet is a checkbox. The coach's verdict sits inside the row. The tag chips are colour-coded by kind. `Used in Backend / platform roles, General SWE — one page` tells you, before you touch anything, which saved variants this edit will reach.

</details>

<details>
<summary><b>The Master Editor</b> — where the text is actually written</summary>

<br/>

<img src="media/editor.png" alt="The Master Editor with collapsible item rows, per-section fields and badge strips" width="100%">

Collapsible rows, per-section field sets, drag handles, and a badge strip per item: the coach score, how many variants use it, `Check dates` when a date is impossible, `Too long · N words` past the 500-word caution, `Not analysed` when tags are pending. The top bar keeps `Unsaved changes` / `No changes` live, blocks `Save & Exit` behind `Fix N dates`, and runs the tagger as part of the save (`Analysing & saving…`).

</details>

<details>
<summary><b>Three variants of the same library</b> — screenshot</summary>

<br/>

<img src="media/variants.png" alt="The variants page: three saved selections with labels, item counts and Load / Update / Duplicate / Delete" width="100%">

Each row reports what it contains (`11 items · Experience 3, Skills 4 …`), which one is currently `Loaded`, and whether the working selection has drifted from it (`Loaded · modified`). Labels are free text and filter the list.

</details>

---

### 2. A real PDF, compiled in your browser

> **What you see is the PDF.** The preview is not an HTML mock-up of a résumé — it is the actual Typst document, recompiled about a third of a second after you stop typing. The download is text-based and selectable, so an ATS can parse it. Nothing is rasterised, and your résumé text never travels to a rendering server.

<img src="media/preview.png" alt="The full-page Typst preview of Alex Morgan's résumé, marked Up to date and 2 pages" width="100%">

Note the toolbar: **`Up to date`** and a yellow **`2 pages`** badge. That page count is measured from the compiled document, not estimated — and it is the number [Tailor](#4-tailor--two-pages-to-one-without-losing-the-must-haves) works against.

<details>
<summary><b>How it works</b> — <code>toTypstDoc()</code> → wasm → SVG / PDF</summary>

<br/>

```mermaid
flowchart TD
    A["ResumeData<br/>the editor model"] --> B["toTypstDoc()<br/>src/lib/typst/doc.ts"]
    B --> C["orderedItems()<br/>filter isSelected<br/>filter hidden[]<br/>format date ranges<br/>attach layout"]
    C --> D["TypstResumeDoc<br/>plain JSON, every field a string or array"]
    D -->|"sys.inputs.resume"| E["main.typ"]
    E --> F["templates/ledger.typ<br/>render(data)"]
    F --> G["typst-ts-web-compiler<br/>~27 MB wasm, 7 MB over the wire"]
    G --> H["compileSvg() → live preview"]
    G --> I["compilePdf() → download"]
    D -.->|"renderedText()"| J["ATS literal check<br/>the exact strings Typst prints"]
    style D fill:#f5f5f5,stroke:#d4d4d4
    style G fill:#e6f7f7,stroke:#239dad
```

**`toTypstDoc` is the single place data is shaped for typesetting.** Templates are pure styling: they do no filtering, no date logic, and they never receive markup. Every field arrives as a string or an array of strings — never `null` — which is why user text containing `# * _ $ [ ] \` needs no escaping. It is printed literally.

The JSON contract:

| key | shape |
|---|---|
| `header` | `{ name, tagline, location, phone, email, github, linkedin, website }` |
| `summary` | string |
| `education[]` | `{ title, institution, date, gpa, minor, details }` |
| `skills[]` | `{ label, value }` |
| `projects[]` | `{ title, stack, date, link, bullets[] }` |
| `experience[]` | `{ title, company, date, bullets[] }` |
| `volunteering[]` | `{ title, organization, date, bullets[] }` |
| `publications[]` | `{ title, venue, date, link, authors }` |
| `awards[]` | `{ title, issuer, date, description }` |
| `certifications[]` | `{ name, issuer, year }` |
| `languages[]` | `{ language, proficiency }` |
| `layout` | `{ order[], page: { margin, size, leading }, sections: { above, below, gap, indent } }` |

Every list entry also carries `space_after`, `break_before` and `keep`.

**Engine details** (`src/lib/typst/client.ts`): the compiler is initialised **once**, lazily, when the preview first mounts; the Inter faces in `public/typst/fonts` are preloaded and remote font assets are disabled, so the output is byte-stable across machines. Because the wasm is single-threaded, every compile is serialised through one promise chain. The preview keeps the last good SVG on screen at 60% opacity while recompiling, so the page never flashes empty.

**Adding a template** is three steps: write `public/typst/templates/<id>.typ` exporting `#let render(data) = { … }`, import it in `main.typ`, add an entry to `TEMPLATES` in `src/lib/typst/templates.ts`. Iterate with the CLI exactly as the browser sees it — only the vendored fonts:

```bash
typst watch --root public/typst --font-path public/typst/fonts --ignore-system-fonts \
  public/typst/main.typ .typst-out/sample.pdf
```

**A failure is never blamed on your words.** If the wasm cannot load, the preview shows a distinct *"The preview engine could not load"* panel with a Retry button, and states plainly that nothing in your résumé is filtered or rejected — a compile diagnostic gets its own separate panel. (The production CSP has to allow `'unsafe-eval'` on `/dashboard` for exactly this reason: the typst.ts glue evaluates a string at start-up.)

</details>

---

### 3. Job Match — how well do you *actually* fit?

> **Paste the job description; get an honest number.** Not a vanity score: it tells you which must-haves you cover, which one disqualifies you, which keywords are missing, and — separately — whether the words are *literally printed* on the page an ATS will scan.

<img src="media/jobs.png" alt="Job Match: score 84, 9 of 10 must-haves covered, guidelines and the ATS keyword check table" width="100%">

Read what the app worked out about Alex, none of it hand-written:

- **84 / 100**, must-haves **9 of 10**, length **2 pages · over one page**.
- **Missing must-have: C++.** The posting wants it for the legacy pricing engine and nothing in Alex's library shows it. This is the disqualifier, and it is called out in red rather than averaged away.
- **`Bachelor's Degree` → `Yes · 2 via Bachelor of Science`.** Alex never wrote the phrase "bachelor's degree" anywhere; the degree hierarchy resolved it.
- **`Microservices` → `Yes · 5 via gRPC, FastAPI`.** The résumé never uses the word "microservices" as a skill — the AI reconcile pass read "five FastAPI microservices behind an API gateway" and recorded the evidence.
- **`Written Communication` → `Yes · 2, inferred from your items`:** the USENIX paper and the mentoring role.
- **`Printed on résumé: Not literally`** on four rows — Alex *has* these, but the exact string is not on the page. That is the ATS warning.

<details>
<summary><b>How it works</b> — the scoring formula, verified against this screenshot</summary>

<br/>

Scoring is **pure and deterministic** (`src/lib/match/score.ts`) and runs in the browser, so toggling an item moves the number instantly with no round trip.

```
strength(r) = covered   ? min(1, 0.5 + 0.25 × carriers)    // 1 item → 0.75, 2+ → 1.0
                          (credentials and languages are binary: any carrier → 1)
            : literal   ? 0.5                              // printed, but no tag backs it
            : 0

score       = 100 × Σ(w · strength) / Σ w
w           = importance × tier      importance: must = 1, nice = 0.4
                                     tier:       hard = 1, soft = 0.3
```

**Tier** is the part that makes the number trustworthy (`requirementTier`). Named technologies, tools, credentials and languages are *hard*. Traits, methodologies, domains, and a built-in list of generic practices (`PRACTICE_KEYS`: SDLC, documentation, software testing, code review, analytical thinking, communication, …) are *soft* — a posting that lists "attention to detail" as a technical requirement cannot sink your score, and a missing programming language cannot be hidden by ten soft-skill hits.

Alex's 84 is arithmetic you can check by hand:

| # | Requirement | kind | must / nice | tier | carriers | strength | w | w × s |
|---|---|---|---|---|---|---|---|---|
| 1 | Go | technical-skill | must | hard | 3 | 1.00 | 1.00 | 1.00 |
| 2 | Kubernetes | tool-platform | must | hard | 2 | 1.00 | 1.00 | 1.00 |
| 3 | gRPC | technical-skill | must | hard | 2 | 1.00 | 1.00 | 1.00 |
| 4 | **C++** | technical-skill | must | hard | **0** | **0.00** | 1.00 | 0.00 |
| 5 | PostgreSQL | tool-platform | must | hard | 3 | 1.00 | 1.00 | 1.00 |
| 6 | SQL | technical-skill | must | hard | 1 | 0.75 | 1.00 | 0.75 |
| 7 | Bachelor's Degree | credential | must | hard | 2 | 1.00 | 1.00 | 1.00 |
| 8 | Microservices | domain | must | soft | 5 | 1.00 | 0.30 | 0.30 |
| 9 | CI/CD | methodology | must | soft | 3 | 1.00 | 0.30 | 0.30 |
| 10 | Written Communication | soft-skill | must | soft | 2 | 1.00 | 0.30 | 0.30 |
| 11 | Terraform | tool-platform | nice | hard | 2 | 1.00 | 0.40 | 0.40 |
| 12 | Observability | domain | nice | soft | 2 | 1.00 | 0.12 | 0.12 |
| 13 | Containerisation | domain | nice | soft | 4 | 1.00 | 0.12 | 0.12 |
| 14 | **Code Review** | methodology | nice | soft | **0** | **0.00** | 0.12 | 0.00 |
| | | | | | | | **Σ 8.66** | **Σ 7.29** |

`100 × 7.29 / 8.66 = 84.2` → **84**, exactly what the app shows. Remove C++ from the posting and the same library scores **95**; leave C++ in but lose Go coverage and it drops to **73**. One missing hard must-have costs about eleven points; one missing soft nice-to-have costs less than two.

**What counts as "covered"** (`src/lib/match/coverage.ts`) — an item covers a requirement when it:

1. carries the **exact** canonical tag key, or
2. carries a key the requirement's `satisfiedBy` list accepts (written by the AI reconcile pass), or
3. carries a key the **built-in hierarchy** accepts (`builtinSatisfiers`: `bachelor's degree` ← any `bachelor of …` / master's / doctorate), or
4. is cited in the requirement's `evidence` list by item id.

**The reconcile pass** (`src/lib/match/reconcile.ts`) exists because exact tag matching misses what a human recruiter sees instantly. It sends *all* requirements plus the candidate's whole tag inventory and condensed items to the text model at **max** reasoning effort and stores the verdict **on the requirement** — so the pure scorer honours it on every later client-side recompute, with no further model calls. It runs in the background via `after()`, state on `job.match { status, runningUntil, checkedAt, libraryHash }`; while it runs the page polls one document read every 5 s. If it fails, requirements stay exactly as they were and the built-in hierarchy still applies — a model outage cannot corrupt your score.

**`literalHit`** searches `renderedText(toTypstDoc(data))` — the exact strings Typst prints, hidden bullets and excluded items removed. That is why the table can honestly say *"in your tags: yes, printed on résumé: not literally"*.

</details>

<details>
<summary><b>Where the requirements come from</b> — JD → structured requirements</summary>

<br/>

`POST /api/jobs/analyze` accepts pasted text **or** an uploaded posting (PDF, DOCX, TXT or a photo — images are transcribed with GLM-4.6V first), and returns structured rows saved on the job document:

```ts
{ name: "kubernetes", display: "Kubernetes", kind: "tool-platform",
  importance: "must", yearsMin: null, satisfiedBy: [], evidence: [], reason: "" }
```

It also returns `fitNotes` — seniority, location and sponsorship conflicts read against your [About you](#8-about-you--advice-that-fits-your-career-stage) answers. Alex's three, verbatim from the screenshot:

> - The posting is explicitly new-grad, which matches the entry level you are targeting.
> - Seattle-based with a hybrid expectation — inside your stated locations and work modes.
> - C++ is listed as a must-have for maintaining the legacy pricing engine, and nothing in your library shows C++.

</details>

---

### 4. Tailor — two pages to one, without losing the must-haves

> **It suggests; you decide.** Tailor never silently rewrites your résumé. It asks about the gaps first, proposes a selection with a reason on every line, marks the items it is not willing to touch, and leaves every suggestion as an Accept / Dismiss you can overrule.

**Step 1 — it asks about what is missing.** Requirements nothing in the library shows yet, hard ones first. A `Yes` adds the skill to the right category and turns your one-line example into a bullet; a `No` is remembered, so the app stops suggesting it and warns you instead.

<img src="media/tailor-questions.png" alt="Tailor step 1: Do you have Code Review? and a yellow box for the previously declined C++" width="100%">

Alex said "no" to C++ on an earlier application, so it appears in the yellow **"You said you don't have these, and this job asks for them"** box with an `I have this now` escape hatch.

**Step 2 — it proposes a selection.** 20 of 22 items, each line explaining itself: `Covers hard requirements: Kubernetes, Terraform` · `Matches none of this job's requirements`. 🔒 marks items it will not drop, because dropping them would lose a hard requirement.

<img src="media/tailor.png" alt="Tailor step 2: the proposed selection with lock badges, reasons and Accept / Dismiss on each suggestion" width="100%">

**Then: one page.** Alex's résumé is two pages. One click on `Fit to one page` and the footer reads **1 page**, 11 of 22 items, score **79 vs 84 now** — the honest cost of fitting, shown before anything is saved.

<img src="media/tailor-fit.png" alt="Tailor after Fit to one page: 11 of 22 items, 1 page, score 79 versus 84" width="100%">

| | Before | After `Fit to one page` |
|---|---|---|
| Items included | 20 of 22 | 11 of 22 |
| Pages | 2 | **1** |
| Score | 84 | 79 |
| Missing must-haves | C++ | C++ *(unchanged — nothing that covered a must-have was dropped)* |

And this is the result, compiled: the same library, trimmed to one page, with every hard-requirement carrier still on it. The ML project and the coffee-shop job are the two things it gave up.

<img src="media/preview-onepage.png" alt="The tailored résumé compiled to a single page, marked Up to date and 1 page" width="100%">

<details>
<summary><b>How it works</b> — locks, protected lines, greedy set cover, and the trim order</summary>

<br/>

The whole plan is a **pure function** (`src/lib/match/auto-tailor.ts`) over the library, the requirements and the page count. The model only ever *adjusts* it.

```mermaid
flowchart TD
    A["requirements + library"] --> B["lock items covering a hard requirement<br/>plus the newest education"]
    B --> C["recommendSelection()<br/>greedy weighted set cover over soft requirements"]
    C --> D["mark lines that literally name<br/>a hard requirement as protected"]
    D --> E["AUTO_TAILOR_SYSTEM_PROMPT<br/>high effort, 180 s"]
    E --> F["mergeAiReview()<br/>ignores anything touching a locked include,<br/>a protected line, an unknown id or index"]
    F --> G["fitToOnePage()"]
    G --> H["diffSuggestions(plan, target, base)<br/>every difference, with a reason"]
    H --> I["Accept / Dismiss per row"]
    style E fill:#fffbeb,stroke:#fde68a
    style F fill:#f0fdf4,stroke:#bbf7d0
```

- **Set cover** (`src/lib/match/recommend.ts`): greedy weighted cover — a must-have is worth 3, a nice-to-have 1, and a requirement saturates after 2 carriers so the algorithm stops padding. It respects per-section caps (`DEFAULT_CAPS`, user-editable in `meta/preferences`), always includes matching skill categories, and never excludes education.
- **`mergeAiReview` is the guard rail.** The model's reply is filtered, not trusted: anything that would flip a locked include, hide a protected line, or reference an id or bullet index that does not exist is dropped on the floor. If the model call fails entirely you get the tag-based plan plus a warning — never a broken selection.
- **The trim order** in `fitToOnePage` is fixed and predictable: bullets of weak unlocked items → those items → unprotected bullets of locked items. **The first bullet of a kept item is never removed**, so no entry is reduced to a bare job title.
- **Overrides always win.** You can switch off a locked item or a protected line; `overrideWarnings` then explains the consequence in yellow ("the only item covering a hard requirement", "a hidden ATS keyword", "no education left") rather than blocking you.
- **Exits:** `Close` writes the selection onto your working selection (so reopening resumes where you left off), `Save variant` writes a variant, `Save variant & download PDF` compiles first and then saves. The two saves require one page or the explicit multi-page tick; `Close` never does.

It also **reuses** the reconcile pass: if `job.match` is done and `reconcileLibraryHash` still matches the library you sent, no reconcile call is made at all.

</details>

---

### 5. Insights — all your keywords in one picture

> **You cannot fix what you cannot see.** Every item is tagged, every tag is weighted by how many *included* items carry it, and the result is one picture of what your résumé actually says about you — plus the history of every job you have scored.

<img src="media/insights.png" alt="Insights: the profile-shape radar, the heaviest-tags bar chart, kind filters and job match history" width="100%">

Alex's library yields **80 distinct tags**. The shape is the story: tools and platforms dominate, soft skills barely register — exactly what you would expect from a student with two internships, and useful to know before writing a cover letter.

```mermaid
pie showData title Alex Morgan - 80 tags by kind
    "Tools & platforms" : 31
    "Domains" : 21
    "Technical skills" : 8
    "Methodologies" : 8
    "Credentials" : 6
    "Soft skills" : 4
    "Languages" : 2
```

<details>
<summary><b>How it works</b> — extraction, the hash rule, and normalisation</summary>

<br/>

Every item in all nine collections, plus the profile headline and summary, carries:

```ts
tags: { name: "kubernetes", display: "Kubernetes", kind: "tool-platform" }[]
```

`kind` is one of `technical-skill · tool-platform · domain · soft-skill · methodology · credential · language`. A tag's **weight** is simply the number of selected items carrying it (`aggregateTags`, computed on read — never stored, so it can never go stale).

**The hash rule** (`src/lib/tags/content.ts`) is the mechanism that keeps AI cost near zero:

```ts
contentHash = stableHash(`${key}|${JSON.stringify(contentFields(key, item))}`)
// contentFields excludes dates, ids, isSelected, timestamps and hidden[]
stale = tagsHash !== contentHash
```

Only **stale** items are ever sent to a model. Toggling an item on and off, reordering sections, hiding a bullet, loading a variant — none of that changes the content hash, so none of it costs a single token. Editing the text does.

**Extraction** (`src/lib/tags/extract.ts`) runs inside the save: stale items go out in chunks of 20, three chunks in parallel, 60-second budget, JSON mode, `low` reasoning effort (≈7 s per chunk). Each chunk also carries a small `tagContext` — headline, degrees, summary — so the model can file items under the candidate's actual field, and the prompt asks for **implied** concepts as well as named ones: "5-service architecture" yields *Microservices*; a compiler project yields *Computer Science* as a domain; a degree yields both the specific degree **and** the generic `Bachelor's Degree` that job postings ask for. **A tagging failure never blocks the save** — items stay stale and the action returns a `tagWarning`.

**Normalisation** (`src/lib/tags/normalize.ts`) is a lowercase canonical key, a built-in alias table (`js → javascript`, `k8s → kubernetes`), plus model-reported aliases stored per user in `meta/tags` — accepted only when the canonical form is itself a returned tag name, and never allowed to override a built-in. `display` keeps the pretty spelling, which is what you see on the chips.

</details>

---

### 6. An AI career coach on every item

> **Line-by-line feedback, not a grade.** Every item gets a score out of ten, named problems ("Passive voice", "No numbers", "Off target") and up to three concrete rewrites where the original text is quoted verbatim and the replacement sits right below it. Accept applies it. Dismiss makes it go away for good.

<img src="media/coach-review.png" alt="A coach review: 4/10, flags Off target, Passive voice, No numbers, and a rewrite with Accept and Dismiss" width="100%">

This is Alex's coffee-shop bullet. The coach scored it **4/10**, named exactly what is wrong, and proposed a fix that turns a passive clause into an action — while telling Alex the honest thing: for a backend application, keep it switched off.

Low-scoring items surface where you cannot miss them:

<img src="media/action-items.png" alt="The Action items card listing the Barista item at 4 out of 10 with Open in editor" width="100%">

<details>
<summary><b>How it works</b> — background runs, a per-user lock, and a parser that refuses invented numbers</summary>

<br/>

Stored on each item as `review`, on `users/{uid}.profileReview` for the profile:

```ts
{ score: 4, flags: ["off-target", "passive-voice", "no-metrics"],
  comment: "…", suggestions: [{ id, field, current, proposed, reason }],
  dismissed: [], reviewHash, briefHash, reviewedAt }
```

**Staleness uses the same hash as tags** (`reviewHash !== contentHashOf(...)`), so a review is marked out of date the moment the text changes — the badge greys out and says so rather than showing a stale number as if it were current.

**Runs are fire-and-forget and never awaited by a save** (`/api/review/run`, `src/lib/ui/review-runner.ts`). They are kicked after `Save & Exit`, by a library effect keyed on the sorted stale ids (each set attempted once per session), by `Re-review` on a row, and by `Re-review {n}` for reviews written against an older candidate brief. The route takes a **per-user lock** (`meta/review.runningUntil`, 409 when busy and the client retries once), then reviews ≤ 24 items per request — selected items first — in chunks of 6, two in parallel, at `high` effort within a 260 s budget.

**The parser is adversarial on purpose** (`src/lib/review/parse.ts`). A suggestion is dropped if it targets a field that does not exist for that section, if its `current` is not found verbatim in the item, if the rewrite is empty, unchanged or bracketed — and, crucially:

> **if the rewrite introduces digits the original did not contain.**

That single rule is what stops a language model from inventing "improved performance by 40%" on your behalf. (Profile rewrites may use numbers from your own candidate brief, and nowhere else.)

Accepting a suggestion goes through the section's normal `update*` server action via `applySuggestionFormData`, so a reworded bullet that was hidden **stays** hidden. Dismissals are an `arrayUnion` on `review.dismissed`, keyed by a content-derived suggestion id, so the same suggestion cannot come back from a later run.

</details>

---

### 7. Import an old résumé in one step

> **Start from what you already have.** Drop in your current PDF, Word file or even a photo of a printout. It is read, split into sections, and matched against what is already in your library — merging detail into items you have instead of creating near-duplicates. Nothing is saved until you have reviewed every row.

<img src="media/import.png" alt="The import view: a dropzone for PDF, DOCX, TXT and images, up to 6 files" width="100%">

<details>
<summary><b>How it works</b> — rasterise in the browser, fuzzy-match, union-merge</summary>

<br/>

```mermaid
flowchart LR
    A["file"] -->|"PDF"| B["pdf.js renders pages<br/>to JPEG in the browser"]
    A -->|"DOCX / TXT / image"| C["sent as-is"]
    B --> D["POST /api/import<br/>multipart, maxDuration 120"]
    C --> D
    D --> E["mammoth · text · image_url parts"]
    E --> F["GLM-4.6V"]
    F --> G["parseModelOutput<br/>lenient zod, per item"]
    G --> H["findMatch<br/>fuzzy, deterministic"]
    H --> I["review step<br/>New · Adds detail · Already in library"]
    I --> J["mergeImport → editor draft"]
    style F fill:#fffbeb,stroke:#fde68a
    style I fill:#f5f5f5,stroke:#d4d4d4
```

- **PDFs are rasterised client-side** because the vision model accepts `text` and `image_url` parts but rejects `file` parts outright, and `response_format: json_object` is text-model-only — so JSON is recovered from the reply with a balanced-brace scan.
- **It is a Route Handler, not a server action**, for two concrete reasons: server actions cap request bodies at 1 MB, and the route needs `maxDuration = 120` because vision calls take 10–60 s.
- **Parsing is lenient by design** (`src/lib/import/parsed-resume.ts`): the envelope never fails, each item is validated on its own, and rejects become `warnings` shown in the review step instead of failing the upload. Dates like `2021`, `Jan 2021`, `03/2021`, `Spring 2020` and `Present` are all normalised to month precision.
- **Duplicate detection is deterministic, not AI** (`src/lib/import/match.ts`): `canon` lowercases, strips accents and punctuation, expands abbreviations (`Sr.`, `B.S.`, `Ph.D.`), drops company suffixes and treats save placeholders as empty; titles match on token Dice ≥ 0.8, and work experience additionally requires the same start **year**. Matches then *merge* — bullets and skill lists are unioned, empty scalar fields filled — so re-importing a newer résumé enriches your library instead of doubling it.
- **Nothing is persisted by the import itself.** It lands in the editor draft and goes through the ordinary `saveResumeData` path when you press `Save & Exit`.

</details>

---

### 8. About you — advice that fits your career stage

> **The same bullet deserves different advice depending on who wrote it.** A two-minute questionnaire — where you are, what you are aiming for, what to emphasise — is condensed into a short candidate brief that every coaching and tailoring prompt receives. It is never printed on your résumé.

<img src="media/about.png" alt="The About you questionnaire, Core tab, prefilled for Alex Morgan" width="100%">

Note the hint under *Years of professional experience*: **"Your library dates add up to 1.5 (internships not counted)."** The app computed that from Alex's stored dates — merging overlapping jobs and excluding internships — before any model was involved.

<details>
<summary><b>How it works</b> — computed facts first, model second, brief cached by hash</summary>

<br/>

Stored at `users/{uid}/meta/characterization`:

| field | what it holds |
|---|---|
| `answers` | Core (field, years, education status, graduation, target roles), Targeting (level, industries, locations, work modes, relocation, authorization), Your story (career change, gaps, strengths, emphasize / de-emphasize) |
| `followUps[]` | 3–5 coach questions, regenerated only when `coreHash(answers)` changes |
| `brief` + `briefHash` | the ≤ 1500-character plain-text brief, and the `answersHash` it was generated from |
| `facts` | `careerStage`, `yearsExperience`, `educationStatus`, `graduation` — all derived from your library dates, not asked |

**Order of operations matters.** Date-derived facts (`src/lib/about/facts.ts`) are computed locally and instantly: `yearsOfExperience` merges overlapping roles and excludes internships, `employmentGaps` counts from the first non-internship job. Only then does `/api/about/prefill` suggest the subjective fields — field, roles, level, industries, strengths — and it is **never** allowed to guess your location or work authorization. Suggested fields are visibly marked *"Suggested from your library. Edit if it's off."* until you touch them.

**The brief is regenerated only when the answers hash changes**, and a failed generation keeps the old brief and sets `briefStale` rather than leaving you with nothing.

**Where it goes:** `readCandidateContext(uid)` is read server-side only — the client never sends it — and feeds JD analysis, reconcile, proposals, auto-tailor, skill-bullet wording and item review. Every one of those prompts appends `CANDIDATE_CONTEXT_RULE`: the brief is context for *relevance and level*, never evidence, and never printed. Tagging and import do not receive it at all.

</details>

---

### 9. Typographic control without a word processor

> **When one line of overflow is the only thing between you and one page.** Margins, font size, leading, the space above and below every section, the gap between entries, per-item spacing, keep-together and page breaks — all adjustable, all as presets with an escape hatch to exact numbers.

<img src="media/editor-layout.png" alt="The Master Editor in advanced layout mode: page layout card, per-section spacing, per-item overrides" width="100%">

<details>
<summary><b>How it works</b> — one working layout, snapshotted per variant</summary>

<br/>

`ResumeLayout` (`src/lib/layout/types.ts`) lives once at `users/{uid}/meta/layout` and is snapshotted into each variant:

| key | meaning |
|---|---|
| `sectionOrder` | the summary plus the nine list sections; the header is always first |
| `itemOrder` | manual order per section — **absent means "by date"** |
| `page` | margin (mm), font size (pt), leading (em) |
| `sections` | per section: space above / below, gap between items, indent (pt) |
| `items` | per item: `spaceAfter`, `breakBefore`, `keepTogether` |

Each control is `Compact · Normal · Relaxed · Custom`, where **`Normal` is exactly the template's own values** — so an untouched layout renders byte-identically to a layout that was never opened. Custom values are clamped by `RANGES`.

**One ordering function serves everything.** `orderedItems` (`src/lib/layout/order.ts`) is used by the editor, the library, the tailor window and `toTypstDoc`, so what you drag is what prints. The default is newest-first: current ("Present") items, then latest end date (a lone start counts as the end), then latest start, undated last. Dragging stores the *displayed* order; "Sort by date" deletes the manual order. Items added later slot in after the last newer item rather than jumping to the end.

Layout writes use `replaceMeta` (a plain `set`) rather than a merge, because a merge would resurrect the keys a reset was supposed to remove. Ids are pruned to existing items and temp ids renamed on save.

</details>

---

## 🧭 A real application, start to finish

Alex applies to Globex Systems. Eight steps, each one a screen above.

```mermaid
sequenceDiagram
    autonumber
    actor A as Alex
    participant L as Library
    participant J as Job Match
    participant T as Tailor
    participant P as Typst (browser)
    A->>L: paste old résumé into Import
    L-->>A: 22 items, duplicates merged, nothing saved yet
    A->>L: Save & Exit
    L-->>L: tag stale items (low effort) · kick coach reviews (background)
    A->>J: paste the Globex posting
    J-->>A: 14 requirements · score 84 · missing must-have C++
    J-->>J: reconcile pass at max effort (background)
    J-->>A: "Microservices ← gRPC, FastAPI" · "Bachelor's Degree ← B.S."
    A->>T: Tailor résumé
    T-->>A: step 1 — "Do you have Code Review?"
    T-->>A: step 2 — 20 of 22 items, reasons, 🔒 on must-have carriers
    A->>T: Fit to one page
    T-->>A: 11 items · 1 page · 79 vs 84
    A->>T: Save variant & download PDF
    T->>P: compilePdf()
    P-->>A: Globex Systems · Backend Engineer.pdf
```

| Step | Screen | What Alex learns |
|---|---|---|
| 1 | [Import](#7-import-an-old-résumé-in-one-step) | the old PDF becomes 22 reviewable items |
| 2 | [Library](#1-one-library-many-résumés) | one item is flagged 4/10 before any employer sees it |
| 3 | [Insights](#5-insights--all-your-keywords-in-one-picture) | 80 tags, heavy on tools, thin on soft skills |
| 4 | [Job Match](#3-job-match--how-well-do-you-actually-fit) | 84/100 — and C++ is the one real blocker |
| 5 | Guidelines | "Code Review" is missing as a keyword, not as a skill |
| 6 | [Tailor step 1](#4-tailor--two-pages-to-one-without-losing-the-must-haves) | answer once; the library learns it permanently |
| 7 | Tailor step 2 | two pages → one costs 5 points and no must-haves |
| 8 | [Preview](#2-a-real-pdf-compiled-in-your-browser) | the PDF is text, one page, and saved as a reusable variant |

---

## 📚 Tutorial: from `git clone` to your first PDF

> **Reading this repository is allowed. Running it is not** — see [the licence](#-license--showcase-only). The tutorial documents how the app is put together and how the author runs it.

<details open>
<summary><b>Step 0 — prerequisites</b></summary>

<br/>

| Need | Why |
|---|---|
| Node 20+ and npm | Next 16 / React 19 |
| A Google Cloud project with OAuth | the only sign-in method |
| A Firebase project with Firestore | the database, via the Admin SDK only |
| A [Z.ai](https://z.ai) API key | import, tags, Job Match, coach reviews, About you |
| *(optional)* the `typst` CLI | iterate on templates without the browser |
| *(optional)* a GitHub token | raises the API limit for profile link checks |

</details>

<details>
<summary><b>Step 1 — install</b></summary>

<br/>

```bash
git clone https://github.com/xuckless/quikresume.git
cd quikresume
npm install
```

`postinstall` copies two vendored binaries into `public/` (both git-ignored):

```
scripts/copy-typst-wasm.mjs    → public/typst/wasm/         (~27 MB: compiler + renderer)
scripts/copy-pdfjs-worker.mjs  → public/pdfjs/pdf.worker.min.mjs
```

If the preview later reports that the engine could not load, this step is what to re-run.

</details>

<details>
<summary><b>Step 2 — Google sign-in (the login flow, end to end)</b></summary>

<br/>

1. In the [Google Cloud console](https://console.cloud.google.com/apis/credentials), create an **OAuth 2.0 Client ID** of type *Web application*.
2. Authorised redirect URI — exactly this, port included:

   ```
   http://localhost:3000/api/auth/callback/google
   ```

   Add the production one too (`https://your-domain/api/auth/callback/google`).
3. Copy the client id and secret into `.env.local` as `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`.
4. Generate the session secret:

   ```bash
   openssl rand -base64 32     # → AUTH_SECRET
   ```

What then happens when you press **Continue with Google**:

```mermaid
sequenceDiagram
    participant B as Browser
    participant P as proxy.ts
    participant N as NextAuth v5
    participant G as Google
    participant F as Firestore
    B->>P: GET /dashboard
    P-->>B: 307 → /login  (no session cookie)
    B->>N: POST /api/auth/signin/google
    N-->>B: redirect to Google consent
    B->>G: consent
    G-->>N: code → /api/auth/callback/google
    N->>F: FirestoreAdapter upserts users/{uid}
    N-->>B: Set-Cookie authjs.session-token (JWE, 14-day maxAge)
    B->>P: GET /dashboard (with cookie)
    P->>P: per-IP burst check · session check
    P-->>B: dashboard RSC — 17 reads in one Promise.all
```

Sessions are **JWT** (`strategy: "jwt"`, 14-day `maxAge`, 1-day `updateAge`); the only callback puts the Firestore user id on `session.user.id`, and `currentUid()` wraps that in React `cache` so one dashboard render decodes the cookie **once** no matter how many server actions read it.

</details>

<details>
<summary><b>Step 3 — Firestore</b></summary>

<br/>

1. Create the database. The app reads a **named** database, not `(default)`:

   ```
   database id: quikresume
   ```

   (`src/lib/firestore.ts`: `getFirestore(app, "quikresume")`.)
2. Create a service account, download the JSON key, and copy three values into `.env.local`. The private key goes on **one line with literal `\n`** — the code unescapes it:

   ```
   FIREBASE_PROJECT_ID=your-project
   FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEv…\n-----END PRIVATE KEY-----\n"
   ```
3. Deploy the deny-all client rules to **both** databases and turn on TTL for the counter collections:

   ```bash
   firebase deploy --only firestore:rules
   gcloud firestore fields ttls update expiresAt --collection-group=rate_limits --database=quikresume
   gcloud firestore fields ttls update expiresAt --collection-group=ai_usage    --database=quikresume
   ```

</details>

<details>
<summary><b>Step 4 — the environment file in full</b></summary>

<br/>

```bash
cp .env.example .env.local
```

| Variable | Required | Notes |
|---|---|---|
| `AUTH_SECRET` | ✅ | `openssl rand -base64 32` |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | ✅ | step 2 |
| `AUTH_TRUST_HOST` | ✅ | `true` for local and Vercel |
| `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` | ✅ | step 3 |
| `GLM_API_KEY` | ✅ | everything AI: import, tags, Job Match, reviews, About you |
| `NEXT_PUBLIC_SITE_URL` | – | canonical URLs, `robots.txt`, `sitemap.xml` |
| `GLM_BASE_URL` | – | default `https://api.z.ai/api/paas/v4` |
| `GLM_MODEL` | – | vision model, default `glm-4.6v` |
| `GLM_TEXT_MODEL` | – | text model, default `glm-5.3-flash` |
| `GLM_EFFORT_RECONCILE` / `_REVIEW` / `_TAILOR` | – | `low \| high \| max` |
| `AI_DAILY_TOKEN_BUDGET` / `AI_DAILY_CALL_BUDGET` | – | per-user per-day ceiling, default 2 M / 400 |
| `GITHUB_TOKEN` | – | raises the GitHub API limit for link checks |

</details>

<details>
<summary><b>Step 5 — run it, and the first-run path</b></summary>

<br/>

```bash
npm run dev     # http://localhost:3000
```

<img src="media/landing.png" alt="The public landing page with the hero, the product sketch and the four feature blurbs" width="100%">

<sub>The public landing page. It is the only page search engines see — `robots.txt` hides `/dashboard`, `/api` and `/login`, and every signed-in page is `noindex, nofollow, nocache`.</sub>

<img src="media/login.png" alt="The login page: Welcome, Sign in to continue to quikResume, Continue with Google" width="100%">

A brand-new account is walked through this, in this order:

1. `/dashboard` with no data → redirect to **`/dashboard/about?first=1`** ("Welcome! A few questions first.") — once only; opening the page marks it seen.
2. **Import** an existing résumé, or add items by hand in the **Master Editor**.
3. `Save & Exit` — this is the moment tags are extracted and coach reviews are kicked off in the background.
4. **Library** — flip the switches for this application.
5. **Preview** (or the docked side pane at ≥ 1280 px) → **Download PDF**.
6. **Job Match** — paste a posting, then **Tailor résumé**.

Other scripts:

```bash
npm run build
npm run lint
npm run typst:sample    # compile public/typst/main.typ against sample.json (needs the typst CLI)
```

</details>

<details>
<summary><b>Step 6 — works on a phone too</b></summary>

<br/>

<img src="media/mobile-library.png" alt="The library on a 390px-wide phone viewport" width="320">

The 240 px sidebar becomes a drawer below 1024 px (`Open navigation`), row subtitles stack, badge strips hide, and the preview moves from a docked pane to its own view below 1280 px. Job Match lays itself out with **container queries** rather than viewport breakpoints, because the space it gets depends on whether the preview pane is open.

</details>

---

## 🔒 Your data, and what happens to it

> **Your résumé is not a marketing asset, and this app treats it that way.** No public client access to the database, no telemetry on your content, no résumé text sent to a rendering service, and an explicit rule in every prompt that your words are data, not instructions.

<details>
<summary><b>1. No client ever touches the database</b></summary>

<br/>

`firestore.rules` is deny-all on **both** databases:

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read, write: if false; }
  }
}
```

Every read and write goes through the Admin SDK inside server components, server actions and route handlers — so a stolen API key or a browser devtools session has nothing to talk to. There is no client Firebase config in the bundle at all.

</details>

<details>
<summary><b>2. Your résumé text is never rendered on a server</b></summary>

<br/>

Typesetting happens in **your** browser, in WebAssembly. The PDF you download was produced on your machine from your data; no server ever receives the document, and the preview cannot leak it because there is nothing to send. The only network traffic during a compile is the one-time wasm fetch from your own origin.

</details>

<details>
<summary><b>3. Untrusted input, everywhere, by default</b></summary>

<br/>

Uploaded résumés and pasted job postings are attacker-controlled text. `src/lib/security/prompt.ts` treats them that way:

| Defence | Mechanism |
|---|---|
| Hidden instructions | `sanitizeForPrompt` strips control, zero-width, bidi and Unicode-tag characters, then caps length |
| Delimiter injection | `fenceUserText` wraps free text in `<<<BEGIN X>>> … <<<END X>>>` and defuses inner delimiters |
| Structured input | passed through `JSON.stringify`, never string-concatenated into the prompt |
| Prompt override | every system prompt ends with `UNTRUSTED_INPUT_RULE` |
| Model output | anything stored (brief, comments, rewrites, requirement names, reasons) goes through `cleanModelText` / `cleanModelBlock` |
| Fake file types | uploads are **sniffed** — PNG/JPEG/WebP magic bytes, DOCX must be a zip — not trusted by MIME type |
| Invented metrics | a rewrite that introduces digits the original lacked is **discarded by the parser** |

</details>

<details>
<summary><b>4. Rate limits and a hard AI budget, per user</b></summary>

<br/>

Every route handler starts with `guardApi(req, RATE.<policy>, { ai, feature })`, which checks — in order — same-origin for non-GET requests, the session, the per-user rate limit, then the GLM key and the daily AI budget.

| Policy | Limit | Policy | Limit |
|---|---|---|---|
| import | 12 / h | tags | 30 / h |
| job analyses | 20 / h | tag backfill | 6 / h |
| reconcile | 20 / h | coach review | 20 / h |
| tailor | 20 / h | About you | 30 / h |
| proposals | 20 / h | link checks | 30 / h |
| skill answers | 30 / h | saves | 60 / h |
| poll | 30 / min | | |

Counters live in a top-level `rate_limits` collection (per user, per policy, written in a transaction) and are mirrored in memory, so an exhausted key is refused **without a read**; if Firestore itself fails, the in-memory count still holds. Per-IP burst limits in `proxy.ts` add 120/min on `/api/*`, 60/min on `/api/auth/*` and 240/min on `/dashboard*`.

The **AI budget** (`src/lib/security/ai-budget.ts`) is the backstop: `chatCompletion` reads an `AsyncLocalStorage` context set by `withAiUser`, refuses with a 429 once the user's UTC day is spent, and records actual `usage.total_tokens` into `ai_usage/<uid>_<day>` broken down by task and model. Defaults: **2 M tokens / 400 calls per user per day**. In production, a model call made *without* that context logs a warning — the design refuses to let an unattributed call slip through.

</details>

<details>
<summary><b>5. Headers, cookies and crawlers</b></summary>

<br/>

| Header | Public pages | `/dashboard*` |
|---|---|---|
| `script-src` | `'self' 'unsafe-inline'` | + `'unsafe-eval' 'wasm-unsafe-eval' blob:` (the typst.ts glue evaluates a string at start-up) |
| `frame-ancestors` | `'none'` | `'none'` |
| `connect-src` | `'self' blob: data:` | `'self' blob: data:` |
| `img-src` | self + Google avatars | self + Google avatars |
| `Cache-Control` | default | `private, no-store` (and on all of `/api/*`) |

Plus HSTS in production, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, a Referrer-Policy, a Permissions-Policy, and no `X-Powered-By`.

`robots.txt` disallows AI crawlers outright and hides `/dashboard`, `/api` and `/login` from everyone; `sitemap.xml` lists public pages only; every signed-in page is `noindex, nofollow, nocache`.

**Two email addresses, on purpose.** Your Google sign-in address is never printed. The address on the résumé is a separate `professionalEmail` field — the login page says so explicitly.

<img src="media/profile.png" alt="The Profile page: the Google account on the left, the résumé header fields on the right" width="100%">

<sub>The Google account sits on the left, deliberately separate from the résumé header on the right: *"Signed in with Google. Your sign-in email stays private; the professional email on the right is the one printed on your résumé."* Contact fields normalise on blur, and a link that 404s gets a red mark — but only while the field still holds that exact URL.</sub>

</details>

<details>
<summary><b>6. Outbound link checking that cannot be turned into a scanner</b></summary>

<br/>

After a profile save, the app verifies the links in your header (`/api/profile/check-links`). The care taken here is the point:

- **LinkedIn is never fetched** — format-checked only (`format-ok`), because LinkedIn blocks datacentre traffic and a red mark would be a lie.
- GitHub goes through `api.github.com/users/<name>`.
- A website gets a `HEAD` (falling back to `GET` on 403/405/501) over `node:http(s)` with a **DNS `lookup` guard that refuses private, loopback, link-local and CGNAT addresses on every hop** — ports 80/443 only, ≤ 3 redirects, 5 s timeout. That closes SSRF: your profile cannot be used to probe an internal network.
- Results are cached 24 h per URL and throttled to one run every 10 s, and **only** `not-found` (404/410/NXDOMAIN) shows the red mark — and only while the field still holds that exact URL.

</details>

<details>
<summary><b>7. What actually leaves your machine</b></summary>

<br/>

| Data | Goes to | When |
|---|---|---|
| Library items, profile, variants, jobs | your own Firestore | on save |
| Item text (stale items only) | Z.ai text model | during a save, tag backfill, or a coach review |
| Uploaded résumé / posting | Z.ai vision or text model | when you press Analyse |
| Candidate brief | Z.ai text model, server-side only | with coaching and tailoring prompts |
| Résumé text for typesetting | **nowhere** | compiled locally in wasm |
| Anything at all | analytics / telemetry | **never — there is none** |

Tagging and import never receive the candidate brief. Toggling, reordering, hiding a bullet and loading a variant send **nothing** to any model — the content hash did not change.

</details>

---

## 🏗 Architecture

```mermaid
flowchart TB
    subgraph browser["Browser"]
        UI["React 19 + React Compiler<br/>Tailwind v4 tokens, light-only"]
        WASM["typst.ts 0.7 → Typst 0.13<br/>single-threaded, serialised compiles"]
        PURE["pure logic, shared with the server<br/>score · coverage · auto-tailor · layout order"]
    end
    subgraph edge["Edge"]
        PX["proxy.ts<br/>per-IP burst · /dashboard session redirect"]
    end
    subgraph server["Server — Next 16 App Router"]
        RSC["RSC pages<br/>17 reads in one Promise.all"]
        ACT["server actions<br/>CRUD per collection + saveResumeData"]
        API["route handlers<br/>guardApi → withAiUser"]
    end
    subgraph data["Data"]
        FS[("Firestore 'quikresume'<br/>Admin SDK only · deny-all rules")]
        RL[("rate_limits · ai_usage<br/>TTL on expiresAt")]
    end
    GLM["Z.ai GLM<br/>glm-4.6v vision · glm-5.3-flash text"]
    UI --> PX --> RSC & ACT & API
    RSC --> FS
    ACT --> FS
    API --> FS
    API --> GLM
    ACT --> GLM
    API --> RL
    ACT --> RL
    UI <--> PURE
    UI --> WASM
    style WASM fill:#e6f7f7,stroke:#239dad
    style GLM fill:#fffbeb,stroke:#fde68a
    style FS fill:#fff7e6,stroke:#ffa000
```

**The data model.** `users/{uid}` holds the profile; nine subcollections hold the library, each item carrying `isSelected`, `tags`, `contentHash`, `tagsHash`, `review`, `createdAt`, `updatedAt`:

| Collection | Fields |
|---|---|
| `experience` | `position, company, startDate, endDate, isActive, description[], hidden[]` |
| `education` | `schoolName, programName, startDate, endDate, isActive, gpa, minorName, details` |
| `skills` | `category, items, hidden[]` |
| `projects` | `title, stack, link, startDate, endDate, isActive, description[], hidden[]` |
| `certifications` · `awards` | `name, issuer, year` · `title, issuer, date, description` |
| `volunteering` | `role, organization, startDate, endDate, isActive, description[], hidden[]` |
| `publications` · `languages` | `title, venue, date, link, authors` · `language, proficiency` |
| `variants` | `name, labels[], items{}, hidden{}, layout, templateId` — **pointers only** |
| `jobs` | `title, company, source, jdText, summary, requirements[], match{}, proposals[], lastScore, fitNotes[]` |
| `meta/*` | `tags` (aliases) · `characterization` (About you) · `layout` · `preferences` · `review` (lock) |

**Reasoning effort is chosen per task, not globally** (`src/lib/glm/effort.ts`) — the expensive passes run in the background so no click ever waits on them:

| Task | Effort | Where it runs |
|---|---|---|
| tags, JD analysis, About you, skill answers | `low` | inline |
| reconcile | `max` | background `after()`, ≤ 250 s |
| coach review | `high` | background route, 260 s budget |
| tailor plan | `high` | `/api/jobs/auto-tailor`, 180 s |

A note on conventions the codebase actually enforces: dates are stored as UTC-midnight Timestamps at month precision and parsed **by parts** (never `new Date("YYYY-MM-DD")`, which shifts the month in negative-offset zones); optional strings are `null`, never `""`; there are no manual `useMemo`/`useCallback` because the React Compiler is on; and no `setState` from props inside effects. The full map lives in [`CLAUDE.md`](../CLAUDE.md).

**Stack:** Next.js 16.1.6 (App Router, Turbopack) · React 19.2 + React Compiler · TypeScript strict · Tailwind CSS v4 (CSS-first `@theme`, no config file) · NextAuth v5 beta with the Firestore adapter · `firebase-admin` · `@myriaddreamin/typst.ts` 0.7 · `pdfjs-dist` · `mammoth` · `zod` · `recharts` · `@dnd-kit` · `lucide-react`.

---

## 🧪 About the example data

**Alex Morgan does not exist.** Every screenshot in this guide was taken against a throwaway account seeded into a **local Firestore emulator** — no real user's data was read, displayed or captured, and nothing was written to a production database. The persona deliberately mirrors [`public/typst/sample.json`](../public/typst/sample.json), the fixture used to iterate on Typst templates, so the README, the sample and the screenshots all describe the same candidate.

Everything the screenshots *compute* is real: the 84 score, the 9-of-10 must-haves, the 80 tags, the two-pages-to-one trim, the coach scores. Those are the application's own pure functions running on the example library — which is why the [scoring table](#3-job-match--how-well-do-you-actually-fit) reproduces the screenshot to the decimal.

Fictional companies (Northwind Cloud, Contoso Health, Globex Systems, Blue Bottle Coffee), `example.com` addresses and `example-alexmorgan` handles are used throughout.

---

## ⚖️ License — showcase only

> ### This project is published as a **showcase**, not as software you may use.
>
> It is **source-available, not open source**. You are welcome to read every line, learn from it, and cite it. You may **not** copy it, run it, deploy it, sell it, fold parts of it into your own project, or use it commercially — and copies of it may not be used commercially either.

**Copyright © 2026 xuckless. All rights reserved.**

| | |
|---|---|
| ✅ **Allowed** | Reading and inspecting the source; personal study, evaluation, security research and reference; the temporary local copies that unavoidably result from browsing or cloning to read it. |
| ❌ **Not allowed** (without prior written permission) | Copying, republishing, mirroring or redistributing it · running, hosting or deploying it — publicly or privately, commercially **or** non-commercially, including for personal use · modifying it or making derivative works · incorporating any part, file, function or design asset into another project or product · selling, licensing or sublicensing it · **using it as training data, fine-tuning data or a retrieval corpus for machine-learning or generative-AI systems** · removing or altering this notice. |

Vendored third-party components keep their own licences, which are unaffected: [Typst](https://github.com/typst/typst), the [Inter](https://rsms.me/inter/) typeface (SIL OFL, see `public/typst/fonts/OFL.txt`), pdf.js, and everything in `package.json`.

Full terms: **[LICENSE](../LICENSE)**. For anything beyond reading, ask first — [@xuckless](https://github.com/xuckless).

<div align="center">
<br/>
<sub>Built by <a href="https://github.com/xuckless">@xuckless</a> · architecture and conventions in <a href="CLAUDE.md">CLAUDE.md</a></sub>
</div>
