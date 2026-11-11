# quikResume

Resume builder. Users keep their full professional history in a **Master Library** (Firestore), toggle items on/off, and
the app renders a tailored résumé with **Typst compiled in the browser** (SVG preview, real text PDF). Job Match scores
the selection against a posting, the Job Tracker follows applications, and a Chrome extension saves postings and autofills
application forms.

## Stack

- Next.js 16.1.6 App Router (Turbopack), React 19 + React Compiler (`reactCompiler: true`), TypeScript strict.
- Tailwind v4, CSS-first: `@theme` + tokens in `src/app/globals.css` (no tailwind.config). Tokens are CSS variables mapped to
  utilities (`bg-surface`, `border-border`, `text-fg-muted`, `text-13`, `bg-accent-subtle`, `text-accent-text`, `bg-paper`, `bg-chart-1`…).
  Fonts via `next/font`: Geist Sans (UI), Geist Mono (numbers, scores, diagnostics). Icons: `lucide-react`.
- Brand: `components/brand.tsx` (`QBolt`, `BrandMonogram`, `Wordmark` with the accent R); static icons in `public/icons`
  (theme-aware favicon.svg, apple-touch, extension sizes) + `public/favicon.ico`.
- NextAuth v5 beta (Google, JWT sessions, 14-day maxAge, `@auth/firebase-adapter`). `src/proxy.ts` is Next 16's middleware.
- `firebase-admin` Firestore, **named database `"quikresume"`** (`src/lib/firestore.ts`). Client rules deny everything.
- `@myriaddreamin/typst.ts` 0.7.0 (Typst 0.13) in the browser; `typst-ts-node-compiler` 0.7.0 on the server (extension PDF / page count).
- AI: Z.ai via plain `fetch` (`lib/glm/client.ts`): `glm-4.6v` (vision import) and `glm-5.3-flash` (text, JSON mode). Voyage
  (`lib/embed/voyage.ts`) for embeddings + rerank. `pdfjs-dist` (browser PDF rasterising), `mammoth` (DOCX), `zod` (lenient parsing).
- `@dnd-kit/core` + `@dnd-kit/sortable` (behind `components/ui/primitives/sortable.tsx`), `recharts` (match page).
- Tests: `vitest` (`npm test`, `test/**/*.test.ts`, pure modules only; `server-only` aliased to a stub). Lint: `eslint-config-next`. No CI.

## Commands

```bash
npm install            # postinstall copies typst wasm -> public/typst/wasm and the pdf.js worker -> public/pdfjs (gitignored)
npm run dev            # http://localhost:3000
npm run build / lint / test
npm run eval:match     # real GLM + Voyage calls, ~2-3 min, never part of npm test (see Job Match)
npm run typst:sample   # compile public/typst/main.typ with sample.json (needs the typst CLI)

# iterate on a template exactly as the browser sees it (vendored fonts only)
typst watch --root public/typst --font-path public/typst/fonts --ignore-system-fonts public/typst/main.typ .typst-out/sample.pdf
typst compile --root public/typst --font-path public/typst/fonts --ignore-system-fonts \
  --input resume="$(cat some.json)" --input template=ledger public/typst/main.typ .typst-out/out.pdf
```

No `typst` CLI: `pip install typst` in a venv gives `typst.compile(...)` with `sys_inputs`. Extension: `cd extension && npm install`,
`WXT_APP_URL=http://localhost:3000 npm run dev`, `npm run build` -> `.output/chrome-mv3`, `npm test`.

**Env** (`.env.local`). Required: `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_TRUST_HOST`, `FIREBASE_PROJECT_ID`,
`FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (escaped `\n` unescaped in code), `GLM_API_KEY`. Optional:

| var | purpose |
|---|---|
| `VOYAGE_API_KEY` (+ `VOYAGE_EMBED_MODEL` voyage-4-lite, `VOYAGE_RERANK_MODEL` rerank-3-lite, `VOYAGE_MAX_RERANK_CALLS` 30) | semantic matching; without it Job Match uses tags only |
| `GLM_BASE_URL`, `GLM_MODEL` (glm-4.6v), `GLM_TEXT_MODEL` (glm-5.3-flash) | model endpoints |
| `GLM_EFFORT_RECONCILE` / `_REVIEW` / `_TAILOR` | `low \| high \| max` overrides |
| `AI_DAILY_TOKEN_BUDGET` / `AI_DAILY_CALL_BUDGET` | per-user daily AI budget (2M / 400) |
| `TURNSTILE_SECRET_KEY` + `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | /start funnel; without them guest AI is refused in production |
| `GUEST_DAILY_*_BUDGET` (120K / 20 per visitor), `GUEST_POOL_*_BUDGET` (4M / 1500 all guests) | guest AI budgets |
| `EXTENSION_IDS` | comma-separated extension ids allowed by CORS on `/api/ext/*` |
| `NEXT_PUBLIC_EXTENSION_URL` | Web Store link on `/dashboard/extension` |
| `NEXT_PUBLIC_SITE_URL`, `SITE_CONTACT_EMAIL` | `lib/site.ts` (default https://quikresume.vercel.app) |
| `GITHUB_TOKEN` | raises the GitHub API limit for link checks |

## Conventions

- `"use server"` modules export only async functions (+ `export type`); every action checks the session and scopes to that user.
  Shared Firestore boilerplate lives in `lib/db/user-collection.ts` (plain `server-only`); never build actions with a factory.
- Route handler files export only route fields (`GET`, `POST`, `runtime`, `maxDuration`…); shared constants go in `lib/`.
- Parse dates by parts with `lib/dates.ts`; never `new Date("YYYY-MM-DD")` (UTC parse shifts the month west of UTC).
- No `setState` from props in effects; key effects on primitive strings; no manual `useMemo` / `useCallback` (React Compiler).
- Optional strings are stored as `null`, not `""`; mappers default missing fields to `""`.
- **UI state is explicit, never a pile of booleans.** A single-flight async action (save, delete, download, analyse) uses
  `useOperation` (`lib/ui/use-operation.ts`: `run(kind, task, fallback)` resolves `{ok, result} | {ok: false, error} | null`,
  null = not admitted or superseded; `reject` for sync validation; `reset`). A genuinely multi-step flow gets one pure
  reducer next to its feature, driven by `useReducer` with events dispatched directly: `lib/ui/editor-workflow.ts` (editor
  save / leave / discard, re-review), `lib/import/import-flow.ts`, `lib/import/linkedin-session.ts`, `lib/match/tailor-flow.ts`,
  `lib/typst/preview-state.ts`, `lib/ext/pairing-flow.ts`. Stale async results are dropped by the reducer (session id / run
  number in the event), not by ref checks; no ref mirrors of state, no boolean-setter shims over a reducer. Mount-time loads
  (script load, prefill) are a small local union, not an operation.
- Browser-persisted UI state uses `createPersistedStore` + `useSyncExternalStore` (`lib/ui/persisted-store.ts`), never storage reads in effects.
- **Theme**: light + dark from tokens only (`:root` / `:root[data-theme="dark"]`); never `dark:` variants. `THEME_SCRIPT` in
  `app/layout.tsx` sets `data-theme` before paint from `localStorage["quikresume.theme"]` (`lib/ui/theme-store.ts`) or the OS. The
  résumé sheet is always `bg-paper`.
- **Visual rules**: accent = brand green (#003200 light / #5fd38a dark), primary fills only; `accent-text` for links / active nav / scores.
  Scores are one green plus a word band (`scoreBand`), never red/amber/green by value. Colours only through tokens; no `font-black`,
  no uppercase micro-labels, radii ≤ `rounded-lg`, shadows ≤ `shadow-sm`. New UI is built from `components/ui/primitives`.
- **Motion** follows one vocabulary: tokens in `globals.css` "Motion system" (`--ease-out/-in/-in-out`, `--dur-*`, `--stagger`,
  `--scale-press`, `--scale-pop`, `--knob-stretch`) mirrored in `lib/ui/motion.ts` (`DUR`, `CSS_EASE`, `staggerDelay`,
  `rubberBand`, presets via `useMotionPresets()`); `test/motion-tokens.test.ts` keeps them identical. Never inline a duration,
  curve or scale.
  - Entrances ease-out; moves ease-in-out (`transition-move`, `t.move`); exits ease-in and 20% shorter (`*-exit` tokens,
    `rise-out`, `settle-out`). Dialogs / popovers 150-250 ms from scale 0.95, out of and back into their trigger (`<Dialog>`).
  - No springs, no bounce: `MotionProvider` defaults every `m.*` to the move preset. Use `m.*`, never `motion.*`
    (`LazyMotion strict` throws).
  - Pressables get `press` (0.97); full-width rows and large cards don't. Toggles are `<Switch>` (knob stretches 12%).
  - Lists: `stagger-children` / `rise-in` with `--i` (30 ms). In-place bodies: `<Reveal open>`; native `<details>` get
    `disclosure`. Swaps overlap: `<Swap>` for icons / labels (blur crossfade), `AnimatePresence mode="popLayout"` + `t.view`
    for bodies. Success: `NoticeBanner tone="success"` or `<Button succeeded>` (one pulse). Reveals and fills use masks.
  - Drags follow the pointer 1:1 (no transition while held), rubber-band past bounds, ease back on release. Cards changing
    container travel on an arc (`useArcMoves`). Shared indicators: `layoutId={useId()}`, `layoutScroll` on scrolling
    ancestors, `layoutRoot` on sticky / fixed ones.
  - Reduced motion: the one block in `globals.css` turns everything off except `.animate-spin` and `.toast-countdown`.
  - The extension cannot import the tokens: `entrypoints/sidepanel/style.css` and `lib/fab.ts` copy the same values.
- Fetches to route handlers go through `readJson` (`lib/ui/fetch-json.ts`): platform timeouts return HTML, not JSON.
- `app/privacy/page.tsx` must match what the code does: update it with any new processor, permission or stored field.
- A new top-level collection keyed by user must be added to account deletion.

## Gotchas

- **Firestore**: `orderBy(field)` silently drops docs missing the field (experience / education / volunteering by `startDate`;
  projects / certifications / awards / publications / languages / custom by `createdAt`; variants / jobs by `updatedAt`), so always write
  it. Batches cap at 500 (`saveResumeData` chunks at 450). `patchJob` runs `stripUndefined` (Firestore rejects `undefined`).
  `set(..., {merge: true})` treats dotted keys literally (only `update()` reads paths) and merges nested maps, so layout writes use
  `replaceMeta`. Background writers (review, backfill, link checks, dismiss) use `update()`, never merge-set (it would recreate a
  deleted item); ignore NOT_FOUND (`code === 5`).
- `readJobs` projects with `select()` and leaves `jdText` out; `readJob` returns it. `applyVariantSelection` writes only changed docs.
- `dashboard/page.tsx` exports `maxDuration = 120` (Save & Exit calls GLM; actions inherit page config). Long GLM work lives in route handlers.
- `next/dynamic({ ssr: false })` only inside Client Components; `useSearchParams` needs `<Suspense>` (`DashboardClient`, `SidebarNav` wrap themselves).
- The preview side pane (≥1280px) is rendered by `DashboardClient` (only it has `resumeData`); below that "Preview" goes to
  `?view=preview`. Width `clamp(360px, stored, 50%)`. Views inside the remaining space use container queries (`@container`, `@4xl:`).
- Typst: wasm ~27 MB (~7 MB gzipped), loaded only when the preview mounts; missing `public/typst/wasm` -> rerun `npm install`.
  Use `json(bytes(str))`; `sys.inputs` values are strings; `main.typ` falls back to `sample.json` only without a `resume` input. No
  CJK / emoji glyphs, and every literal symbol in a template must exist in all vendored fonts (`test/typst-glyphs.test.ts`;
  list markers are drawn, not typed). (CJK: enable `preloadFontAssets({assets: ["cjk"]})` in `client.ts` if needed). Never name a parameter `h`.
- `schema.ts` imports `defaultLayout` from `lib/layout/presets.ts`, so `presets.ts` imports only types from `@/types/schema`.
- Nested `SortableList`s are separate `DndContext`s; only handles start a drag. Single-section tabs still need a `SortableList`.
- `useResumePageCount` returns `{ pages, error }`; show the error, not an endless "…".
- Testing server-only code outside Next: alias `server-only` to an empty module and use `node --env-file=.env.local`.
- ESLint ignores `public/pdfjs/**`, `public/typst/wasm/**`; root tsconfig / eslint ignore `extension/`.
- `glm-5.x` rejects `thinking: disabled`; the client sends `reasoning_effort` instead.

## Code map

```
src/
  auth.ts, proxy.ts, lib/firestore.ts        auth, middleware (burst limit + /login redirect), db
  lib/db/*                                   server-only Firestore helpers; session.ts currentUid() / asUser(uid, fn)
  lib/security/*, lib/validation/*           see Security; validation/dates.ts date rules
  app/page.tsx, (auth)/login, privacy, start public pages; robots / sitemap / opengraph-image (Satori: >1 child needs display:flex)
  app/(dashboard)/layout.tsx                 signed-in shell (AppShell: 240px sidebar >= lg, drawer below); pages render <TopBar>
  app/(dashboard)/dashboard/*                page (Library / Editor / Preview / Import / Jobs via ?view=), profile, variants,
                                             about, extension, autofill
  app/actions/*-actions.ts                   server actions per collection + resume (save), layout, user, variant, job, tag, about,
                                             review, library, auth
  app/api/{import,tags,jobs,about,review,profile,ext,guest,dev}/*   route handlers (see sections below)
  app/logo/[domain]/route.ts                 company favicons for the tracker
  components/dashboard-client.tsx            view switch, editor draft, leave guard, preview pane
  components/ui/primitives/*                 UI kit (Button, Field, Switch, Badge, Tabs, Segmented, Card, Table, ExpandableRow,
                                             TopBar, Dialog/ConfirmDialog, Drawer, EmptyState, ScoreRing, NoticeBanner, ChipInput, Reveal, Swap)
  components/ui/{library,editor,job-match,job-tracker,review,about,start,landing}/*
  lib/{match,tags,review,about,import,contact,layout,typst,embed,glm,jobs,ext,autofill,guest,demo}/*
  types/schema.ts (editor model ResumeData), types/db.ts (Firestore rows)
public/typst/  main.typ, templates/{ledger,classic,modern,compact}.typ, lib/theme.typ, fonts/ (Inter, IBM Plex Sans/Serif,
               Libertinus Serif + OFL), sample.json, wasm/ (gitignored)
extension/     WXT + React Chrome MV3 project (see Browser extension)
```

## Data model (Firestore)

`users/{uid}`: `firstName, lastName, headline, professionalEmail, phoneNumber, location, github, linkedIn, website, bio, links,
profileTags, profileContentHash, profileTagsHash, profileReview, linkChecks, linkChecksAt, loadedVariantId, updatedAt` (+ NextAuth fields).

Item subcollections; every item doc also has `isSelected, tags, contentHash, tagsHash, review, createdAt, updatedAt`:

| collection | fields |
|---|---|
| `experience` | `position, company, startDate, endDate, isActive, description[], hidden[]` |
| `education` | `schoolName, programName, startDate, endDate, isActive, gpa, minorName, details, locationCity?, locationProvince?, locationCountry?, doubleMajor?` |
| `skills` | `category, items, hidden[]` |
| `projects` | `title, stack, link, startDate, endDate, isActive, description[], hidden[]` |
| `certifications` | `name, issuer, year, credentialId, expires` (also licences: "Issuer · No. X" / "2019 · exp. May 2027") |
| `awards` | `title, issuer, date, description` |
| `volunteering` | `role, organization, startDate, endDate, isActive, description[], hidden[]` |
| `publications` | `title, venue, date, link, authors` |
| `languages` | `language, proficiency` |
| `custom` | `section, title, subtitle, startDate, endDate, isActive, description[], hidden[]` |

Other per-user docs:

| doc | fields |
|---|---|
| `variants` | `name, labels[], items: {<section>: id[]}, hidden: {itemId: key[]}, layout \| null, templateId` (pointers only) |
| `jobs` | `title, company, source, jdText, summary, requirements[], match, proposals[], proposalsAt, lastScore, fitNotes[], seniority, titleSim, status, appliedAt, notes, variantId, url, urlKey, location, employmentType, companyDomain` |
| `vecs/{itemId}` | `space, hash, units: [{k, v}]` cached embeddings, deleted with the item |
| `meta/layout` | working `ResumeLayout` |
| `meta/tags` | `aliases` |
| `meta/characterization` | About you: `status, answers, followUps, brief, briefHash, briefStale, facts, …` |
| `meta/review` | `runningUntil, lastRunAt` (review lock) |
| `meta/autofill` | Autofill preferences |
| `meta/preferences` | `mutedProposals[], caps, declinedSoftSkills[]` (hard + soft) |

Top-level: `rate_limits/{policy}__{uid}`, `ai_usage/{uid}_{day}` (and `guest-pool_{day}`), `extension_codes/{sha256}`,
`extension_tokens/{sha256}`. All with `expiresAt` where they expire: enable a TTL policy per collection group, e.g.
`gcloud firestore fields ttls update expiresAt --collection-group=rate_limits --database=quikresume`.

Dates: Firestore `Timestamp` at UTC midnight, day 01. Editor model `startDate: "YYYY-MM-01" | ""`, `endDate: "YYYY-MM-01" | "Present" | ""`
(`"Present"` <-> `isActive: true, endDate: null`). `description` is newline-separated in the editor, `string[]` in Firestore.

## Dashboard data flow

1. `dashboard/page.tsx` (RSC) loads the profile, the 10 item collections and `meta/layout`, builds `initialResumeData` (`toResumeData`).
   It redirects to `/dashboard/about?first=1` once when there is no characterization doc and no `?view`.
2. `DashboardClient` reads `?view=editor|preview|import|jobs` (none = Library; `?view=jobs&job=<id>` = a job's Match page, `jobHref()`)
   and navigates with `router.push`; the page never unmounts. It holds `draft: ResumeData | null`: the editor shows `draft ?? initialResumeData`,
   every other view `initialResumeData`. Opening the editor copies server truth into the draft; the draft is **never re-derived from
   props**, so revalidations can't clobber edits. Leaving with unsaved changes via the sidebar asks Save & leave / Discard / Keep
   editing (`lib/ui/leave-guard.ts`); reload / close get the browser prompt; browser Back discards.
3. The editor edits with `onChange(prev => next)`. New items get `tmp-<uuid>` ids; deletes go to `pendingDeletes` and are applied by
   the save, so Discard brings them back. Duplicate inserts a `tmp-` copy after the original.
4. `saveResumeData(draft, {deleted})` refuses bad dates or a malformed email (`{success: false, error, invalidIds, field?}`, nothing
   written), normalises contacts, writes the user doc + every item (a `tmp-<uuid>` goes to doc `<uuid>`, so retries never duplicate),
   tags stale items, then writes the layout (pruned, temp ids renamed). Rate-limited (`RATE.save`).
5. Library rows call `update*` / `delete*` actions through `<form action>` wrappers; failures land in the dashboard banner and optimistic
   toggles revert. Delete names the variants using the item. Library search (title / subtitle / tags) disables drag while it has text.
6. The Profile page edits the same user fields through `updateUserProfile`; both paths go through `personalInfoToUserDoc`.
7. `isSelected` is the **working selection**. A variant is a snapshot of selected ids + hidden keys + layout; loading one rewrites
   `isSelected` / `hidden` / `meta/layout`. Editing an item used by variants shows a badge and a confirm on Save & Exit.

## Library and editor rules

- **Order** (`lib/layout/order.ts`, `orderedItems`, shared by Editor, Library, Tailor and Typst): newest first (Present, then latest
  end, then latest start, undated last); awards / publications by `date`, certifications by `year`; skills / languages keep load order.
  Dragging stores `itemOrder[section]`; later items slot in by date. "Sort by date" clears it. Editor drags edit the draft, Library drags
  call `updateLayout`, Tailor drags travel on `TailorSelection.layout`.
- **Layout** (`lib/layout/types.ts`): `sectionOrder`, `itemOrder`, `page` (margin / font / leading), `sections` (above / below / itemGap /
  indent), `items` (spaceAfter / breakBefore / keepTogether), `headings` (printed heading overrides ≤ 40 chars), `theme`. Advanced
  layout mode (editor switch) exposes Compact / Normal / Relaxed / Custom per level (clamped by `RANGES`; Normal = template defaults).
  Item-level controls only for `ENTRY_SECTIONS`. Variants with `layout: null` leave the working layout alone.
- **Editing order**: in the editor a row whose dates are being edited keeps its place (`orderedItemsPinned`) until it collapses
  or loses focus; everything else uses the real order. Unnamed skills categories (empty / "Skills" / "General" / the printed
  heading) print without a label (`isPlaceholderSkillCategory`).
- **Sub-items**: experience / projects / volunteering / skills / custom carry `hidden: string[]` of `bulletKey` (squashed text) or
  `skillKey` (lowercased) from `bulletLines`. Text-keyed, so reordering is safe and rewording un-hides. `saveResumeData` prunes dead keys.
  `hidden` is not a content field (never stales tags). Typst, page count, ATS check and PDF honour it; tag coverage is per item.
- **Custom sections**: each `custom` entry names its printed heading; `toTypstDoc` groups by heading (case-insensitive, first spelling)
  and prints the groups at the `"custom"` slot. Import routes unrecognised sections there. Bodies without `custom` are filled with `[]`
  (`withAllSections`).
- **Word cap** (`lib/text/word-count.ts`): warn only; counter from 400 words, caution at `WORD_CAUTION = 500`; over-cap items and
  low-scoring reviews (≤ `LOW_SCORE` 5) are listed in the Action items card, whose links open the editor on that row.
- **Dates** (`lib/validation/dates.ts`): month precision via `MonthField` (selects; no `<input type="month">`). End without start,
  end before start, or a start / single date after this month is an error; future ends are fine; certification year is `YYYY`, not
  future. Errors block Save & Exit ("Fix N dates").
- **Contacts** (`lib/contact/normalize.ts`, on blur, on save, on import): email `local@domain.tld` is the only blocking check;
  NANP phones -> `(123) 456-7890`, other international / leading-0 numbers kept with a note; LinkedIn -> `https://www.linkedin.com/in/<slug>`,
  GitHub -> `https://github.com/<user>`, websites get `https://`. Extra `links` (≤ 6 `{label, url}`) print after them in every template.
- **Link checks** (`/api/profile/check-links`, after saves that change a link): LinkedIn format only; GitHub via the API; websites
  HEAD (GET fallback) with a DNS guard against private / loopback / link-local / CGNAT on every hop, ports 80/443, ≤ 3 redirects, 5 s.
  Results on `users.linkChecks` (24 h cache); only `not-found` shows the red mark while the field still holds that URL.

## Typst pipeline

```
ResumeData --toTypstDoc()--> TypstResumeDoc (JSON) --sys.inputs.resume--> main.typ --> templates/<id>.typ render(data)
```

- `toTypstDoc` (`lib/typst/doc.ts`) is the **only** place data is shaped: ordering, `isSelected` / `hidden` filtering, date ranges,
  bullets, layout + per-entry layout fields; every field a string or array, never null. Templates are pure styling and receive plain
  strings (no escaping needed). `renderedText` (ATS check) skips `layout`.
- `lib/typst/client.ts`: lazy singleton (wasm from `/typst/wasm`, remote fonts off, sources registered one at a time), every compile
  serialised through one promise chain. `compileSvg` / `compilePdf` default to `doc.layout.theme.template`. `ResumePreview`
  (`next/dynamic`, ssr false) debounces 300 ms on `JSON.stringify(doc)`, keeps the last good SVG, shows diagnostics, and shows an
  engine panel with Retry for `TypstEngineError`.
- **Pages**: typst.ts renders all pages into one SVG; `svgLayout` (`lib/typst/pages.ts`, HTML parser) reads the `g.typst-page`
  boxes and the preview shows each page as a clipped window with "n / N".
- **Theme** (`lib/layout/theme.ts`, `layout.theme`): `templateId`, `accent` (`ACCENTS`, `"template"` = its own), `font`
  (`FONT_PAIRS`), `paper` (`a4 | us-letter`). Set from the Preview toolbar / template gallery; variants snapshot it. Every family in
  a pair must be in `FONT_URLS` and `public/typst/fonts`.
- **Adding a template**: `public/typst/templates/<id>.typ` exporting `render(data)`; register in `main.typ` and `TEMPLATES`
  (`lib/typst/templates.ts`). Import helpers from `/lib/theme.typ`, start with `resolve(data, accent:, heading-font:, body-font:)`,
  iterate `data.layout.order`, honour page / section / entry layout (see `stack-entries` in `ledger.typ`), use `heading-for` for
  headings and `sticky: true` on heading blocks.

| key | shape |
|---|---|
| `header` | `{ name, tagline, location, phone, email, github, linkedin, website, links }` |
| `summary` | string |
| `education[]` | `{ title, institution, date, gpa, minor, details }` |
| `skills[]` | `{ label, value }` |
| `projects[]` | `{ title, stack, date, link, bullets[] }` |
| `experience[]` / `volunteering[]` | `{ title, company \| organization, date, bullets[] }` |
| `publications[]` | `{ title, venue, date, link, authors }` |
| `awards[]` | `{ title, issuer, date, description }` |
| `certifications[]` | `{ name, issuer, year }` |
| `languages[]` | `{ language, proficiency }` |
| `custom[]` | `{ heading, entries: [{ title, organization, date, bullets[] }] }` |
| `layout` | `{ order, page: { margin, size, leading }, sections: { <key>: { above, below, gap, indent } }, headings, theme }` |

Every list entry also carries `space_after` (pt), `break_before`, `keep` (unbreakable unless false).

## Resume import

```
file --(browser)--> PDF? pages -> JPEG (pdf.js) : as-is --POST /api/import--> DOCX mammoth | TXT | image_url parts
  --> glm-4.6v (lib/import/prompt.ts) --> parseModelOutput (zod, lenient; = JSON extraction + parseImportObject) --> review step --> mergeImport into the draft --> Save & Exit
```

- Route handler (bodies > 1 MB, `maxDuration = 120`); nothing persisted until the normal save.
- `glm-4.6v` takes `text` + `image_url` (≤ 5 MB each); no `file` parts, no JSON mode, so JSON is pulled out with a balanced-brace scan.
- Each item validates on its own; rejects become warnings. `lib/import/dates.ts` normalises "2021", "Jan 2021", "Spring 2020", "Present".
- Duplicates: `findMatch` (`lib/import/match.ts`): canonical text (accents, abbreviations, company suffixes, save placeholders),
  title token Dice ≥ 0.8, work also needs the same start year. `mergeImport` unions bullets / skills and fills empty fields; rows are
  labelled New / Adds detail / Already in library. Several files per session (`combineParsedFiles`). Personal info fills blanks unless
  "Replace my existing details" is ticked.

## LinkedIn import

```
Import view -> Import from LinkedIn -> extension opens the saved profile URL in a new tab -> side panel Import
  -> DOM parsed into an ImportEnvelope (extension/lib/profile-extract.ts, no AI) -> page: parseImportObject -> same review step
```

- One session at a time, one reducer per side: web `lib/import/linkedin-session.ts` (hook + card in
  `components/ui/linkedin-import.tsx`), extension `extension/lib/linkedin-session.ts` (background driver; `background.ts` only
  wires it). Every message carries the session id; stale ones are dropped by the reducers. Leaving the Import view cancels.
- Protocol and validation live in `src/lib/ext/bridge.ts` (`linkedin-start / cancel / received` from the page;
  `hello{linkedIn}`, `linkedin-started / capturing / captured / capture-failed / ended`, `disconnected` from the extension).
  The extension imports it, `canonicalProfileUrl` (`lib/import/linkedin.ts`) and `ImportEnvelope` (`lib/import/envelope.ts`)
  by relative path, so those three files stay import-free plain TS.
- Missing / unpaired / outdated extension -> notice + `/dashboard/extension?reason=missing|pair|update`. No saved URL ->
  dialog -> `saveLinkedInUrl` (canonical URL only, returns `{ok, url | error}`; thrown action errors are masked in production).
- Security: port only from the app origin; paired account === page uid (at start and before every capture); the tab's
  canonical URL === the saved URL before and after capture; payload ≤ `MAX_PROFILE_JSON`; tab close / page gone / worker
  restart end the session with a message. Never navigates LinkedIn, never signs in, leaves the tab open; the checkmark shows
  after the page acknowledges.
- Parsing anchors on card ids (`#experience`, `#education`, …), outermost `<li>`s and `aria-hidden` text pieces, not class
  names; each card parser fails alone ("Could not read Projects."), cards cut short ("Show all" -> `/details/`) add a
  warning. English month names only. Fixtures in `extension/lib/profile-extract.test.ts` are hand-built: re-check against
  the live site when LinkedIn changes its markup.
- No AI at import time: nothing is sent to a model until the normal save (tags, review). Privacy page says so.

## Smart tags

Every item and the profile headline + bio carry `tags: {name, display, kind}[]`, kind ∈ `technical-skill | tool-platform | domain |
soft-skill | methodology | credential | language`. Weight = number of selected items carrying it (`aggregateTags`).

- **Stale** when `tagsHash !== contentHash` (content fields only, `lib/tags/content.ts`). Reviews use the same hashes.
- **Extraction** (`lib/tags/extract.ts`, in `saveResumeData`): chunks of 20, 3 parallel, 60 s, low effort, with `tagContext` (headline,
  degrees, summary). Asks for implied concepts; tools must be named; degrees yield the degree and its generic level. Failure never blocks a
  save (`tagWarning`). `POST /api/tags/analyze` tags drafts without saving; `POST /api/tags/backfill` re-tags stale (or `force` all).
- **Normalisation** (`lib/tags/normalize.ts`): lowercase key + built-in aliases (no ambiguous short forms like `cv`, `cs`, `ms`, `ba`,
  `rest`; degree and licence abbreviations across fields) + model aliases in `meta/tags` (never overriding built-ins).
  `BUILTIN_SATISFIERS`: degree hierarchy and licence ladders (NP ⊃ RN ⊃ LPN, master ⊃ journeyman).
- Profile tags live on `ResumeData.profileTags`, not inside `PersonalInfo`.

## About you (candidate brief)

`meta/characterization` holds answers (Core, Targeting, Your story, 3–5 AI follow-ups) condensed into a **brief** (≤ 1500 chars) that
coaching and tailoring prompts receive.

- First visit prefills date-based facts (`lib/about/facts.ts`: years excluding internships, education status, gaps), then
  `/api/about/prefill` suggests field / roles / level / industries / strengths (never location or authorization). Follow-ups regenerate
  when `coreHash` changes. Opening the page marks it seen; a Library nudge shows until `complete`.
- `/api/about/save` with `complete` rewrites the brief when `answersHash` changed; failure keeps the old one with `briefStale`.
- `readCandidateContext(uid)` (server only) feeds JD analysis, reconcile, proposals, tailor, skill bullets and reviews via
  `candidatePayload`; those prompts append `CANDIDATE_CONTEXT_RULE` (context, never evidence, never printed). Tags and import don't get it.

## Item review (AI coach)

Every item and the profile get `review: {score 0–10, flags[], comment, suggestions[{id, field, current, proposed, reason}], dismissed[],
reviewHash, briefHash, reviewedAt}` (`users.profileReview` for the profile); stale by content hash.

- `/api/review/run` (`lib/ui/review-runner.ts`), fire-and-forget: after Save & Exit, for stale Library ids (once per set per session),
  Re-review on a row, and "Re-review N" for reviews on an older brief. Per-user lock (`meta/review`, 409 -> client waits 60 s and
  retries once); ≤ 24 items per request in chunks of 6, 2 parallel, high effort, 260 s; re-tags stale items in the batch.
- Parser keeps ≤ 3 suggestions whose `current` is verbatim in the item and drops empty / unchanged / bracketed rewrites or ones adding digits.
- UI: neutral `ScoreBadge` on Library rows (greyed when stale), `ReviewPanel` with Accept (the section's `update*`; a reworded hidden
  bullet stays hidden) / Dismiss. Read-only in the editor; Profile accepts via `updateProfileFields`.

## Job Match

**Analyse** (`POST /api/jobs/analyze`, core in `lib/match/analyze-job.ts`, shared with the extension): pasted text or a file -> text
model -> `requirements: {name, display, kind, importance: must|nice, yearsMin}`, plus `seniority`, `fitNotes`, `companyDomain`.

**Background enrichment** (`runReconcileJob` via `after()`, max effort, ≤ 250 s; also `POST /api/jobs/reconcile` "Re-check with AI").
State on `job.match {status, runningUntil, checkedAt, libraryHash, warning}`; the page polls `GET /api/jobs/reconcile?jobId=` every 4 s (`MATCH_POLL_MS`).
Failures never block: the job scores on tags.

1. **Semantic evidence** (`lib/match/evidence.ts`): library units (`lib/match/units.ts`: item head + each bullet with title / org / dates
   context) embedded with voyage-4-lite @512, cached in `vecs/{itemId}` (re-embedded on content hash or `VECTOR_SPACE` change).
   Requirements + job title embedded per run -> cosine -> CSLS (`cslsMatrix`, penalises generic lines) -> best unit per item, top 8 ->
   rerank-3-lite when cosine-only p ∈ [0.15, 0.9] (budget `VOYAGE_MAX_RERANK_CALLS`; a 429 stops reranking) -> calibrated p
   (Platt fit, `lib/match/calibration.json`) -> top 5 hits with p ≥ 0.15 stored as `requirement.semantic`. `job.titleSim` per work item.
2. **Reconcile / judge** (`lib/match/reconcile.ts`): the text model sees all requirements, the tag inventory, condensed items and hints
   (semantic hits in `JUDGE_BAND` [0.25, 0.9)), and returns per requirement `satisfiedBy` (tag keys that count), `evidence` (item ids)
   and `reason`; hints get `confirmed` true / false. Lower credentials never satisfy higher ones.
3. **O*NET categories** (`lib/match/taxonomy.ts`, data from `scripts/build-taxonomy.mjs`, CC BY 4.0, credited in the footer): a
   requirement that embeds ≥ 0.6 to a software / tool category and is not itself a product is satisfied by candidate tags that are
   products of that category ("Counts as <category> (O*NET)"). Products of one category are never related to each other.

**Coverage** (`lib/match/coverage.ts`): exact key, `satisfiedBy`, built-in satisfier, or cited evidence. Selection code
(`coveredByItem`) also counts a non-rejected semantic hit with p ≥ `SEMANTIC_COVERS` (0.6).

**Score** (`lib/match/score.ts`, pure, browser; header comment has every formula): evidence e = 0.95 exact (binary kinds 1) / 0.9
cited / 0.85 satisfying tag / semantic p (confirmed ≥ 0.9, rejected 0.4·p; credentials / languages capped at 0.6 unless confirmed),
× recency 0.5^(age/4y); unselected items and hidden bullets never count. Strength m = noisy-OR of the top 3. Sub-scores: coverage
(w = must 1 / nice 0.4 × hard 1 / soft 0.3), ats, years, title (× `seniorityFit`, `lib/match/seniority.ts`), education; weights
`SUB_WEIGHTS` .55/.15/.10/.10/.10. A hard must with m < 0.3 caps at `MUST_GATE_CAP` 70. `band` = ±95%; `row.gain` = points for fully
evidencing a requirement. UI: `components/ui/job-match/match-breakdown.tsx`. Callers with a saved job pass `scoreOptionsFor(job)`.

**Recommend** (`lib/match/recommend.ts`): greedy Σw·m under per-section caps (`meta/preferences.caps`), `MIN_GAIN` per pick; "covers"
ignores recency. Skill categories that match are always in; education is never excluded.

**Job page**: requirements grouped Hard / Soft, a Guidelines card (missing must-haves, keyword gaps, declined skills, fit notes), the
Tailor résumé button. The Suggestions card is off (`SHOW_SUGGESTIONS = false`); `/api/jobs/proposals` and mute rules remain.

**Tracker** (`?view=jobs`, `tracker-view.tsx`): Board (dnd-kit columns) / Table, search. Jobs carry `status`
(`saved|applied|interview|offer|rejected`), `appliedAt` (stamped when leaving saved), `notes`, `variantId`, `url`, `urlKey`
(`lib/jobs/canonical-url.ts`), `location`, `employmentType`. Drag and the status Select both call `setJobStatus`. A re-import with a known
`urlKey` refreshes posting fields only. `saveJobScore` writes `lastScore` only (no `updatedAt`) as soon as the final score (never the provisional one) differs, and
revalidates so the tracker never shows a cached older number; shown as a `ScoreRing`. The whole card drags (title included;
the status select does not). Logos: `companyDomainOf(job)` (`lib/jobs/company-domain.ts`, rejects job boards / ATS hosts) -> `GET /logo/<domain>`
(signed-in, Google s2 favicon, 404 -> monogram).

**Eval & calibration**: `npm run eval:match` (`test/eval/match.eval.ts`, cases in `match-cases.json`) scores tags-only then the full
`enrichRequirements` pass and reports precision / recall / F1 per stage; `EVAL_CASES`, `EVAL_RUNS`, `EVAL_EFFORT`; reports in
`test/eval/.results/`. Calibration: `node --env-file=.env.local scripts/calibration/fit.mjs [extra.json]` over `seed.json`; refit
whenever the embedding or rerank model changes.

## Tailor window

```
questions (uncovered reqs) -> window on the working selection -> POST /api/jobs/auto-tailor -> fit to one page (browser Typst)
  -> highlighted suggestions -> Close | Save variant | Save variant & download PDF
```

- **Questionnaire** (`skill-questions.tsx`, `/api/jobs/skill-answers`): requirements with strength 0 on the whole library, hard first.
  Yes adds the skill to a "Soft skills" category or to the picked / model-picked technical category (an optional example becomes a
  bullet); touched items are re-tagged and get the requirement's tag, and the receiving category is switched on with the
  answered skills un-hidden (`lib/match/answered-skills.ts`), since the job page scores only the working selection. The
  questions are a snapshot taken when the dialog opens (a reconcile landing mid-answer must not reshuffle them). No goes to `declinedSoftSkills` and shows in Guidelines.
- **Plan** (`lib/match/auto-tailor.ts`, run by `lib/match/tailor-run.ts`): items covering a hard requirement (+ newest education) are
  locked; the rest follow `recommendSelection`; lines naming a hard requirement are protected. The model (high effort, 180 s) may flip
  unlocked decisions and hide unprotected lines; `mergeAiReview` ignores anything else. Reconcile is reused when
  `reconcileLibraryHash` matches, else run inline at low effort. AI failure -> tag-based plan + warning.
- **Suggestions, not decisions**: `fitToOnePage` trims (weak bullets, then weak items, then unprotected bullets of locked items) and
  `diffSuggestions` lists each change with a reason (Accept / Dismiss / Accept all). "Allow more than one page" shows the untrimmed
  set. `overrideWarnings` explains switching off a locked item or protected line.
- **Close** writes the selection (and layout) to the working selection; **Save variant** uses `createVariantFromPlan`; saves need one
  page or the multi-page tick.

## Browser extension (`extension/`)

WXT + React + TS, Chrome MV3.

- **Pairing** (`lib/ext/tokens.ts`; a browser pairing again sends its old token as `replaces`, replaced only when it belongs to
  the same user): `/dashboard/extension` creates an 8-char single-use code (10 min, sha256 in `extension_codes`).
  Click-to-connect posts it to `site.content.ts` (app origin only), which forwards to the background -> `POST /api/ext/pair`; else
  the code is typed into the side panel. Tokens `qr_…` stored only as sha256 in `extension_tokens` (≤ 10 per user, revocable, verify
  cache 30 s).
- **API** (`src/app/api/ext/*`, `guardExtension`: Bearer token, rate limit, AI budget, CORS only for `chrome-extension://<EXTENSION_IDS>`,
  web origins rejected): `pair`, `me`, `signout`, `jobs` (GET `?url=`, POST import), `jobs/[id]` (summary, PATCH status / variantId),
  `variants`, `tailor`, `tailor/save`, `autofill/{profile,answers,unmapped}`, `resume/pdf`. Summaries (`lib/ext/match-summary.ts`) score
  server-side on the job's variant or the working selection; `asUser(uid, fn)` lets token code reuse the session-based getters.
- **Tab state** (`lib/tab-state.ts`, `lib/types.ts`): one `TabState` per tab in `chrome.storage.session` under
  `tab-state:v<STATE_VERSION>:<id>` (bump the version when the shape changes incompatibly; old keys are swept). `save`,
  `tailor` and `autofill` are the phases of their own operations; `notice` is only the last failure of the small actions
  (scan, refresh, status, résumé). `getState` applies `settleInterrupted`: a saving / running phase with no live handler in
  this worker becomes a retryable failure, and an Auto Fill run silent for 45 s closes as complete or "no form". Handlers
  run through `exclusive()`. The side panel is `checking | unpaired | paired`; links use the build-time `appUrl()`.
- **Detection** (`lib/extract.ts`): site adapters -> JSON-LD `JobPosting` -> readable-text heuristic. `postingUrl` turns LinkedIn /
  Indeed / Glassdoor list panes into the posting URL (Indeed falls back to the highlighted card's `data-jk`). Indeed search pages read
  the right-hand pane (`vj-job-title`, `company-info-metadata`, `.simple-job-description-html`). `lib/detector.ts` re-checks on SPA
  navigation, reports to the background (badge `•` / score) and mounts the floating button (`lib/fab.ts`, per-site / global off).
  Auto-run on `lib/sites.ts` hosts; elsewhere "Scan this page" (activeTab). Tests: `lib/extract.test.ts` (jsdom).
- **Side panel**: connect, save & match, score ± band, must-haves, what would raise it, status, résumé picker, quick tailor
  (`/api/ext/tailor` -> `runTailorPlan` + server page count; save via `createVariantFromPlan({load: false})` linked as `variantId`).
  Footer: "AI can make mistakes please review the work before applying."
- **Auto Fill** (`fill.content.ts` in every frame, `lib/fields.ts`): finds labels, `classify`s fields, fills empty ones with the native
  setter + input / change / blur, matches select / radio options, attaches the PDF (`/api/ext/resume/pdf`, native Typst compiler) via
  `DataTransfer`, sends open questions to `/api/ext/autofill/answers` (low effort; never answers protected-characteristic questions),
  outlines filled (solid) and AI (dashed) fields, reports unmapped fields. Never submits, never ticks checkboxes.
- **Autofill preferences** (`/dashboard/autofill`, `meta/autofill`, clamped by `readAutofillPrefs`): address, salary, notice / start,
  work authorization / sponsorship / relocation (prefilled from About you), EEO (default decline), how did you hear, saved answers (used
  verbatim), agent instructions, unmapped fields.
- Distribution: Chrome Web Store (unlisted first); then set `EXTENSION_IDS` and `NEXT_PUBLIC_EXTENSION_URL`.

## Guest funnel (/start)

Signed-out `StartFlow`: import (`/api/guest/import`) or a sample (`lib/demo/samples.ts`) -> field + target role -> template (real
`ResumePreview`) -> paste a job (`/api/guest/match`: JD analysis + tagging, low effort, no brief / reconcile / embeddings) -> teaser
(score, must-haves, blurred rows) -> Google sign-in. Signed-in visitors go to `?view=import`.

- Nothing is stored server-side: the draft is `localStorage["quikresume.guestDraft"]`. `<GuestClaim>` in the dashboard layout runs
  `claimGuestDraft` once: an uploaded résumé is saved only into an empty library, the job is created from its stored requirements,
  then the store is cleared. Samples are never claimed.
- `guardGuest`: same-origin, per-visitor rate limit (`guest-<sha256(AUTH_SECRET|ip)>`, import 4/h, match 6/h), Turnstile, then the
  per-visitor and pool AI budgets.

## Security

Every route handler starts with `guardApi(req, RATE.<policy>, {ai?, …})`: same-origin for non-GET, session, per-user rate limit, then
for AI routes the GLM key and daily budget; model calls run inside `withAiUser(uid, task, …)`. Server actions get Next's origin check.

- **Rate limits** (`lib/security/rate-limit.ts`): fixed windows per user per policy in `rate_limits` (transaction, mirrored in memory,
  memory fallback on Firestore errors); 429 with `Retry-After` and `{rateLimited: true}`. Per-IP burst in `proxy.ts`: 120/min `/api`,
  60/min `/api/auth`, 240/min `/dashboard`.
- **AI budget** (`lib/security/ai-budget.ts`): `chatCompletion` reads the AsyncLocalStorage context, refuses with `GlmError(429)` when
  the UTC day is spent and records tokens into `ai_usage`. `after()` callbacks re-enter the context.
- **Prompt hardening** (`lib/security/prompt.ts`): `sanitizeForPrompt`, `fenceUserText`, JSON for structured input, `UNTRUSTED_INPUT_RULE`
  on every system prompt; stored model output goes through `cleanModelText` / `cleanModelBlock`. Uploads are sniffed by magic bytes.
- **Input bounds** (`lib/validation/limits.ts`): `clampResumeData` on every save and `resume` body, `formStr` for FormData,
  `readJsonBody` size caps, ≤ 200 jobs / variants per user, every client doc id passes `isDocId`.
- **Headers** (`next.config.ts`): public CSP `script-src 'self' 'unsafe-inline'`; `/dashboard*` and `/start` add `'unsafe-eval'
  'wasm-unsafe-eval' blob:` (typst.ts evaluates a string on start-up; `/start` also allows Turnstile). `frame-ancestors 'none'`, HSTS,
  nosniff, `no-store` on `/dashboard*` and `/api/*`.

## Reasoning effort

`glm-5.3-flash` takes `low | high | max` (no `medium`; API default `max`). Reasoning counts toward `max_tokens`, so `maxTokensFor`
raises it (32K high / 64K max) and the client throws "cut off (token limit)" on `finish_reason: "length"`.

| task | effort | runs |
|---|---|---|
| tags, JD analysis, About you, skill answers, autofill answers, proposals' reconcile | low | inline |
| reconcile | max | background `after()` |
| coach review | high | background route, 260 s |
| Tailor plan | high | `/api/jobs/auto-tailor`, 180 s |

Routes with high / max calls export `maxDuration = 300`. `POST /api/dev/effort-compare` (404 in production) runs one task at each effort.

## Account deletion

Profile → Delete account (typed DELETE) -> `deleteAccount`: extension tokens and codes, NextAuth `accounts`, `rate_limits` docs, then
`recursiveDelete(users/{uid})` and sign-out to `/?deleted=1`. `ai_usage` expires by TTL.
