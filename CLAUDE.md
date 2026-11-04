# quikResume

Resume builder. Users keep their full professional history in a **Master Library**
(Firestore), toggle items on/off, and the app renders a tailored résumé with
**Typst compiled in the browser** (SVG preview, real text PDF download).

## Stack

- Next.js 16.1.6, App Router, Turbopack, React 19 + React Compiler (`reactCompiler: true`), TypeScript strict
- Tailwind CSS v4 (CSS-first: `@import "tailwindcss"` + `@theme` in `src/app/globals.css`; no tailwind.config).
  Design tokens live there as CSS variables (`--bg`, `--surface`, `--border`, `--fg-muted`, `--accent`, `--danger`, …)
  mapped to utilities (`bg-surface`, `border-border`, `text-fg-muted`, `text-13`, `bg-accent-subtle`, `text-accent-text`, `bg-paper`,
  `bg-chart-1`, …). Fonts: Geist Sans (`--font-geist-sans`) for UI, Geist Mono for numbers / scores / diagnostics, via `next/font`.
  Icons: `lucide-react`. Brand (Route A): `components/brand.tsx` (`QBolt`, `BrandMonogram`, `Wordmark` "quikResume" with the
  accent R); static icons in `public/icons` (favicon.svg follows the OS theme, apple-touch-icon.png, extension/icon-*.png) and
  `public/favicon.ico`, rendered from the same 32-unit paths.
- NextAuth v5 beta: Google provider, JWT sessions, `@auth/firebase-adapter`; `src/proxy.ts` (Next 16 name for middleware) guards `/dashboard/*`
- `firebase-admin` Firestore, **named database `"quikresume"`** (`src/lib/firestore.ts`)
- `@myriaddreamin/typst.ts` 0.7.0 (+ `typst-ts-web-compiler`, `typst-ts-renderer`), wraps Typst 0.13
- Resume import: Z.ai GLM-4.6V (vision) via plain `fetch` (`src/lib/glm/client.ts`), `pdfjs-dist` (browser PDF
  rasterising), `mammoth` (DOCX text), `zod` (lenient output parsing)
- Smart tags + Job Match: Z.ai text model `glm-5.3-flash` in JSON mode (same client); `recharts` is still a dependency (charts on the match page)
- Drag to reorder: `@dnd-kit/core` + `@dnd-kit/sortable` behind `components/ui/primitives/sortable.tsx`
- Tests: `vitest` (`npm test`, `test/**/*.test.ts`, pure modules only; `server-only` is aliased to a stub). No CI.
  Lint is `eslint-config-next` (core-web-vitals + typescript).

## Commands

```bash
npm install          # also runs postinstall: copies typst wasm into public/typst/wasm and the pdf.js
                     # worker into public/pdfjs (both gitignored)
npm run dev          # http://localhost:3000
npm run build
npm run lint
npm run typst:sample # compile public/typst/main.typ with sample.json (needs the `typst` CLI)
```

Iterate on a template with the CLI exactly as the browser sees it (only the vendored Inter fonts):

```bash
typst watch --root public/typst --font-path public/typst/fonts --ignore-system-fonts \
  public/typst/main.typ .typst-out/sample.pdf
# feed arbitrary JSON the way the app does
typst compile --root public/typst --font-path public/typst/fonts --ignore-system-fonts \
  --input resume="$(cat some.json)" --input template=ledger public/typst/main.typ .typst-out/out.pdf
```

Required env (`.env.local`): `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_TRUST_HOST`,
`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (escaped `\n` newlines are unescaped in code),
`GLM_API_KEY` (import, tags, Job Match, reviews, About you). Optional: `GITHUB_TOKEN` (raises the GitHub API limit for link checks), `GLM_BASE_URL` (default `https://api.z.ai/api/paas/v4`),
`GLM_MODEL` (vision, default `glm-4.6v`), `GLM_TEXT_MODEL` (tags / JD analysis / proposals, default `glm-5.3-flash`),
`TURNSTILE_SECRET_KEY` + `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (Cloudflare Turnstile for the signed-out /start funnel; without them guest AI
is refused in production and allowed in dev), `GUEST_DAILY_TOKEN_BUDGET` / `GUEST_DAILY_CALL_BUDGET` (per visitor, 120K / 20) and
`GUEST_POOL_TOKEN_BUDGET` / `GUEST_POOL_CALL_BUDGET` (all guests together, 4M / 1500), `EXTENSION_IDS` (comma-separated Chrome extension ids allowed by CORS on `/api/ext/*`), `NEXT_PUBLIC_EXTENSION_URL` (Web Store link
on `/dashboard/extension`), `GLM_EFFORT_RECONCILE` / `GLM_EFFORT_REVIEW` / `GLM_EFFORT_TAILOR` (`low | high | max`, see Reasoning effort),
`AI_DAILY_TOKEN_BUDGET` / `AI_DAILY_CALL_BUDGET` (per-user daily AI budget, see Security). `VOYAGE_API_KEY` (semantic matching;
without it Job Match runs on tags only), optional `VOYAGE_EMBED_MODEL` (default `voyage-4-lite`), `VOYAGE_RERANK_MODEL`
(`rerank-3-lite`), `VOYAGE_MAX_RERANK_CALLS` (30 per job).

## Layout

```
firestore.rules, firebase.json               deny-all client rules for both databases (the app only uses the Admin SDK)
src/
  auth.ts, lib/firestore.ts                  auth + db singletons (JWT sessions, 14-day maxAge, signIn page /login)
  proxy.ts                                   Next 16 middleware: per-IP burst limit on /api and /dashboard + sign-in redirect
  lib/security/{guard,rate-limit,memory-limit,ai-budget,request,prompt}.ts   see Security
  lib/validation/limits.ts                   LIMITS, clampStr / clampResumeData / clampPersonalInfo, isDocId / assertDocId
  lib/db/session.ts                          currentUid() / requireUid(): one auth() per request (React cache)
  app/page.tsx, (auth)/login                 public pages (MarketingHeader/Footer in components/marketing-header.tsx);
                                             page.tsx also emits the WebApplication JSON-LD
  app/{robots,sitemap}.ts                    /robots.txt (AI crawlers disallowed, /dashboard + /api + /login hidden,
                                             search engines allowed) and /sitemap.xml (public pages only)
  app/opengraph-image.tsx, twitter-image.tsx 1200x630 social card via next/og (Satori: every div with >1 child needs
                                             display:flex); twitter-image re-exports it
  lib/site.ts                                SITE_URL (NEXT_PUBLIC_SITE_URL, default https://quikresume.vercel.app),
                                             name / tagline / description / keywords shared by all of the above
  app/(dashboard)/layout.tsx                 signed-in shell: auth() -> <AppShell> (sidebar + drawer); pages render <TopBar>
  app/(dashboard)/dashboard/{page,profile/page,variants/page}.tsx
  app/api/import/route.ts                    POST upload -> GLM-4.6V -> ResumeData draft (see Resume import)
  app/api/tags/{analyze,backfill}/route.ts   tag unsaved draft items (nothing persisted) / re-tag stale library items
  app/api/jobs/{analyze,proposals,reconcile}/route.ts   JD -> requirements (+ reconcile when the form carries `resume`) /
                                             gap -> proposals (re-reconciles first; UI hidden) / re-run the reconcile pass for a saved job
  app/api/jobs/{auto-tailor,skill-answers}/route.ts   tailor plan for suggestions (see Tailor window) / questionnaire answers -> library
  app/api/about/{prefill,follow-ups,save}/route.ts   About you: suggested answers / coach questions / save + candidate brief
  app/api/review/run/route.ts                background coach review of changed items (see Item review)
  app/api/profile/check-links/route.ts       header link verification after a save (see Contact & links)
  app/api/dev/effort-compare/route.ts        dev only: one AI task at low / high / max side by side (see Reasoning effort)
  app/(dashboard)/dashboard/about/page.tsx   About you questionnaire; app/(dashboard)/error.tsx error boundary
  app/actions/*-actions.ts                   "use server" CRUD per collection + resume-actions.ts (save + tagging)
                                             + layout-actions.ts (getLayout / updateLayout: meta/layout)
                                             + user-actions.ts (profile), variant-actions.ts, job-actions.ts, tag-actions.ts,
                                             auth-actions.ts (signOutAction, passed to the client sidebar),
                                             about-actions.ts (summary / seen / skip), review-actions.ts (dismiss),
                                             library-actions.ts (setSectionSelection: Include all / Exclude all)
  lib/db/{user-collection,meta,variants,jobs,load-resume,characterization}.ts   server-only Firestore helpers
                                             (loadLibraryWithReviews = loadResumeData + reviews per item; userDoc() validates ids,
                                             readUserDoc() is request-cached, formStr / formStrOrNull / formBullets cap FormData)
  components/shell/{app-shell,sidebar-nav,shell-context}.tsx   240px sidebar (>=lg) / drawer (<lg); ShellContext.openDrawer
  components/ui/primitives/*                 the UI kit: Button/IconButton, Field (Label/Input/Textarea/Select/Checkbox),
                                             Switch, Badge/TagChip, Tabs, Segmented, Card/SectionHeader, Table, ExpandableRow,
                                             TopBar (sticky; rows: title+actions / tabs / banner), Dialog+ConfirmDialog
                                             (native <dialog>), Drawer, EmptyState, ScoreRing, NoticeBanner, icons.ts
  components/dashboard-client.tsx            view from `?view=` (lib/ui/use-dashboard-view.ts); TopBar per view; draft state
                                             + editor leave guard (lib/ui/leave-guard.ts, used by the sidebar links); preview pane grid
  components/ui/section-tabs.tsx             "All | Profile | <sections with counts>" filter strip (Library + Editor)
  components/ui/library/{library-view,library-section,library-row}.tsx   dense expandable rows; server-action forms;
                                             sections / rows in layout order, draggable (saves instantly)
  components/ui/editor/{resume-form,editor-section,editor-item-row,section-fields,personal-info-section,date-range-fields}.tsx
                                             the Master Editor: collapsible item rows, per-section field config, drag handles
  components/ui/editor/layout-controls.tsx   advanced layout mode: PageLayoutCard, SectionLayoutControls, ItemLayoutControls
  components/ui/action-items-card.tsx        yellow "Action items" (over-cap items, bad dates) on Library + Editor
  components/ui/profile-form.tsx             Profile page form -> updateUserProfile (+ profile review panel)
  components/ui/contact-field.tsx            ContactInput: normalise on blur, format issue, red broken-link mark
  components/ui/about/about-form.tsx         About you steps (Core / Targeting / Your story / Follow-ups)
  components/ui/review/{score-badge,review-panel}.tsx   coach score badge / review with Accept / Dismiss
  components/landing/landing-demo.tsx        interactive landing demo: profession samples (lib/demo/samples.ts), item toggles, an HTML
                                             approximation of the 4 templates (no Typst on the landing page), live scoreJob + "What would raise it"
  app/start/page.tsx, components/start/*     signed-out onboarding (see Guest funnel)
  components/ui/resume-import.tsx            multi-file upload (PDF -> page images) + combined review step
  components/ui/variant-toolbar.tsx          Save as / Load / Update variant on the library view
  components/ui/variants-page.tsx            /dashboard/variants: search, labels, rename, duplicate, delete, load
  components/ui/job-tracker/tracker-view.tsx  Job Tracker home (?view=jobs): Board (dnd-kit columns per status) / Table, search
  components/ui/library/stale-tags-notice.tsx  "N items changed since skills were detected" + Analyse (POST /api/tags/backfill)
  components/ui/template-gallery.tsx         TemplateSelect (preview toolbar) + gallery dialog (thumbnails, accent, fonts, paper)
  components/ui/job-match-view.tsx, proposal-cards.tsx, use-page-count.ts   Job Match (grouped requirements, Guidelines card)
  components/ui/job-match/{tailor-dialog,skill-questions}.tsx   Tailor window + hard/soft skill questionnaire
  lib/match/auto-tailor.ts                   pure: buildTailorPlan, mergeAiReview, selections, diffSuggestions, trimSteps /
                                             fitToOnePage, overrideWarnings
  components/ui/resume-preview.tsx           Typst preview + PDF download (client only; `compact` for the side pane)
  components/ui/pane-resize-handle.tsx       drag / keyboard splitter for the preview pane (width in preview-pane-store)
  components/ui/sub-item-toggles.tsx         per-bullet checkboxes / per-skill chips (Library: SubItemToggles in library-row, Editor)
  lib/ui/{review-runner,link-check,fetch-json,about-nudge-store}.ts   background review runs, link check kick, readJson
                                             (non-JSON replies -> { ok: false }), nudge banner dismissal
  lib/ui/{use-dashboard-view,use-media-query,persisted-store,preview-pane-store,expansion-store,leave-guard}.ts
                                             URL view state, matchMedia hook, useSyncExternalStore stores (pane open in
                                             localStorage, expanded row ids in sessionStorage)
  components/ui/primitives/chip-input.tsx    free-text list input (Enter / comma adds)
  lib/dates.ts, lib/ids.ts, lib/hash.ts      date-string helpers (month precision), temp ids, stableHash (content hashes)
  lib/validation/dates.ts                    validateItemDates / invalidDateItems (editor gate + server re-check)
  lib/text/word-count.ts                     per-item word counts, WORD_CAUTION, overCapItems
  lib/layout/{types,presets,order}.ts        ResumeLayout, presets / normalizeLayout / pruneLayout, orderedItems / move*
  lib/sections.ts                            ResumeListKey <-> Firestore collection names, item labels
  lib/resume-mapper.ts                       Firestore rows -> ResumeData (server); personalInfoToUserDoc
  lib/glm/client.ts                          chatCompletion() for Z.ai (server-only): vision + text models, JSON mode
  lib/glm/effort.ts                          reasoning effort per task (effortFor, env overrides, maxTokensFor)
  lib/import/{prompt,dates,parsed-resume,merge,match,types}.ts   import prompt, date normaliser, zod parser, union merge,
                                             fuzzy duplicate matching
  lib/import/pdf-pages.ts (browser), document-text.ts (server)   upload -> GLM parts, shared with /api/jobs/analyze
  lib/tags/{types,content,normalize,prompt,extract,aggregate}.ts   smart tags (see Smart tags)
  lib/about/{types,facts,prompt,library-summary}.ts   About you: answers, dates-based facts, prompts + CANDIDATE_CONTEXT_RULE
  lib/review/{types,content,apply,prompt,parse,run}.ts   coach review (run.ts server-only)
  lib/contact/{normalize,types,link-check}.ts   email / phone / link normalisation (pure), link checks (link-check server-only)
  lib/variants.ts                            pure variant helpers (selectedIds, selectedHidden, applyVariant, variantUsage)
  lib/sub-items.ts                           per-bullet / per-skill selection keys (see Sub-item selection)
  lib/match/{types,text,score,coverage,recommend,proposals,prompt,resume-body}.ts   Job Match scoring, coverage, set cover, proposals (pure)
  lib/match/reconcile.ts                     server-only "broader context" pass: LLM reconciles requirements vs the whole library
  lib/typst/doc.ts                           ResumeData -> TypstResumeDoc (the JSON contract)
  lib/typst/client.ts                        browser singleton around typst.ts
  lib/typst/templates.ts                     template registry
  types/schema.ts                            editor model (ResumeData)
  types/db.ts                                serialized Firestore row types
public/typst/
  main.typ                                   entry: picks template, reads sys.inputs.resume
  templates/{ledger,classic,modern,compact}.typ   styling templates exporting render(data)
  lib/theme.typ                              shared: resolve(data, defaults) -> accent / fonts / paper, helpers, stack-entries
  fonts/                                     Inter, IBM Plex Sans, IBM Plex Serif (TTF), Libertinus Serif (OTF); OFL texts alongside
  sample.json                                full sample doc for CLI iteration
  fonts/Inter-*.ttf (+ OFL.txt)              vendored fonts
  wasm/                                      gitignored, filled by scripts/copy-typst-wasm.mjs
public/pdfjs/pdf.worker.min.mjs              gitignored, filled by scripts/copy-pdfjs-worker.mjs
```

## Data flow

1. `dashboard/page.tsx` (RSC) fetches profile + `experience`, `education`, `skills`, `projects`,
   `certifications`, `awards`, `volunteering`, `publications`, `languages`, `custom` in parallel and builds
   `initialResumeData` with `toResumeData`.
2. `DashboardClient` reads the view from `?view=editor|preview|import|jobs` (no param = library; the removed `insights` maps to `jobs`;
   `?view=jobs&job=<id>` opens one job's Match page, `jobHref()`) and
   navigates with `router.push` so Back works; the page never unmounts, so `draft` survives view switches.
   It holds `draft: ResumeData | null`. In the editor `resumeData = draft ?? initialResumeData`; every other view reads
   `initialResumeData`, so a stale draft can never hide what Job Match / variant actions just wrote.
   Opening the editor copies server truth into the draft; Save calls `saveResumeData(draft)` then clears it;
   Discard just clears it. The draft is **never re-derived from props**, so `revalidatePath` refreshes
   after server actions cannot clobber unsaved edits. Leaving the editor with unsaved changes through the sidebar
   opens "Save & leave / Discard / Keep editing" (`setLeaveGuard` + `interceptNavigation`); reload / tab close get the
   browser prompt; browser Back out of the editor discards the draft (popstate).
   `ResumeData.layout` comes from `users/{uid}/meta/layout` (`getLayout`, normalised in `toResumeData`).
3. `ResumeForm` edits through a functional `onChange(prev => next)`. New items get `tmp-<uuid>` ids
   (`src/lib/ids.ts`). Deleting a persisted item only removes it from the draft and records it in `pendingDeletes`
   (dashboard-client); `saveResumeData(draft, { deleted })` deletes it in the same batches, so Discard / Back bring it back.
   Duplicate inserts a `tmp-` copy after the original (also in a manual `itemOrder`).
4. `saveResumeData` rejects the draft (`{ success: false, error, invalidIds, field? }`, nothing written) when
   `invalidDateItems` finds bad dates or the email is malformed (`contactBlocking`), normalises contact fields, then writes personal info to `users/{uid}` and every list item into its
   subcollection, chunked under Firestore's 500-writes-per-batch limit. A `tmp-<uuid>` item is written to doc `<uuid>`
   (not an auto id), so retrying a save that failed part-way can't create duplicates. The layout is written last
   (`replaceMeta`, ids pruned to existing items, temp ids renamed).
5. Library cards call `update*`/`delete*` actions via `<form action>` wrappers that catch failures and report them in the
   dashboard banner (`onError`; optimistic toggles revert); Delete asks first and names the variants using the item.
   A plain save shows "Saved.". The Library search (title / subtitle / tags) turns drag off while it has text.
6. The Profile page (`/dashboard/profile`) edits the same `users/{uid}` fields through `updateUserProfile`
   (returns `{ success: false, error, field: "email" }` instead of throwing on a bad email; `{ success: true, info }` with the
   normalised values); both it and `saveResumeData` go through `personalInfoToUserDoc` so the written shape stays identical.
7. `isSelected` is the **working selection**. A variant (`/dashboard/variants`) is a snapshot of the selected
   ids; loading one rewrites `isSelected` on every item. Editing an item used by variants shows a badge and a
   confirm dialog on Save & Exit (variants are pointers, so the edit shows up in all of them).

## Layout and order

`ResumeLayout` (`lib/layout/types.ts`): `sectionOrder` (summary + 9 list sections; the header is always first),
`itemOrder` (manual order per section, absent = by date), `page` (margin mm / font pt / leading em), `sections`
(per-section above / below / itemGap / indent pt), `items` (per-item spaceAfter / breakBefore / keepTogether).
One global working layout in `meta/layout`; variants snapshot it.

- **Order** (`lib/layout/order.ts`): `orderedItems` is the one ordering used by the Editor, the Library, the Tailor window and
  `toTypstDoc`. Default is newest first: current ("Present") first, then latest end (a lone start counts as the end), then latest
  start, undated last. Awards / publications by `date`, certifications by `year`. Skills and languages have no dates and keep load
  order (skills are sorted by `createdAt` in memory). Dragging stores the displayed order in `itemOrder[key]`; items missing from
  it (added later) slot in after the last newer item. "Sort by date" deletes the manual order.
- **Dragging**: Editor edits `draft.layout` (saved on Save & Exit); Library calls `updateLayout` (optimistic); Tailor puts the
  layout on `TailorSelection.layout`, Close passes it to `applyWorkingSelection`, Save variant to `createVariantFromPlan`.
  The Library hides the Summary but keeps its position in the order. Section tabs follow `sectionOrder`.
- **Variants**: `layout` is snapshotted by create / update / save-from-plan and copied on duplicate; loading writes it to
  `meta/layout`. Variants saved before layouts (`layout: null`) leave the working layout alone.
- **Advanced layout mode** (editor TopBar switch, localStorage `advanced-layout-store`): page card on top, section spacing under
  each section header, "Layout for this item" inside item rows. Each is Compact / Normal / Relaxed / Custom (exact values,
  clamped by `RANGES`). Normal = the template's original values, so an untouched layout renders exactly as before.
  Item gap and item overrides only exist for entry sections (`ENTRY_SECTIONS`: experience, education, projects,
  volunteering, publications, awards); skills / certifications / languages print as one grid or line.
- **Headings**: `layout.headings[sectionId]` renames a printed section heading (≤ 40 chars, "Licences & Certifications"); edited in
  the advanced layout section controls, passed as `layout.headings` in the Typst doc, read by every template through
  `heading-for(data, key, fallback)` in `lib/theme.typ`.
- Writes use `replaceMeta` (plain `set`): `writeMeta` merges nested maps, so reset keys would survive.

## Word cap and dates

- **Word cap** (`lib/text/word-count.ts`): per item, all text fields including hidden bullets, warn only. Counter from 400
  words, caution at `WORD_CAUTION = 500` (badge on the editor row, yellow note in the item, summary field caution). Listed in
  the Action items card, whose links remount the editor with that row open (`initialOpenId`).
- **Dates** are month precision: `MonthField` (month + year selects; `<input type="month">` is missing in Firefox / Safari)
  stores `"YYYY-MM-01"`; `toDateInputValue` drops stored days, the next save writes day 01. Rules (`lib/validation/dates.ts`):
  everything optional; end without start is an error; end before start is an error (same month is fine); a start or single
  date after the current month is an error; future end dates are allowed; certification year must be `YYYY`, not future.
  Errors show inline, disable Save & Exit ("Fix N dates" jumps to the first), and the import review flags them.

## Custom sections

`custom` is a 10th list section (`CustomEntry` in `types/schema.ts`, collection `custom`, `custom-actions.ts`): each entry names its
own printed `section` heading ("Clinical Rotations", "Teaching", "References"…) and has title / subtitle / dates / bullets with
per-bullet hiding, like volunteering. `toTypstDoc` groups selected entries by heading (case-insensitive, first spelling wins, in
order of first appearance) and every template prints each group as its own section at the `"custom"` position of the section order
(the per-section "Printed heading" override is hidden for it). Import routes any unrecognised résumé section there. Bodies and guest
drafts from clients that predate it (no `custom` key) are filled with `[]` (`withAllSections` in `lib/match/resume-body.ts`).

## Sub-item selection

Experience, projects, volunteering and skill categories carry `hidden: string[]`: keys of bullets
(`bulletKey`, whitespace-squashed text) or skills (`skillKey`, lowercased) switched off individually.

- Keys come from the printed lines (`bulletLines`: trimmed, leading `-`/`•`/`*` dropped), the same in the Library, Editor,
  variants and Typst. Keys come from the text, so reordering is safe and rewording a hidden line brings it back. `saveResumeData` stores
  `pruneHidden(...)` so keys whose text is gone are dropped.
- `toTypstDoc` filters them (a skill category with every skill hidden is omitted). Page count, the ATS literal check
  and the PDF follow; tag coverage in Job Match is per item and still counts a hidden bullet's tags.
- `hidden` is not in `contentFields`: toggling never stales tags.
- Library toggles save instantly through the section's `update*` action (`hidden` = JSON array in the FormData,
  `useOptimistic` in `SubItemToggles`); the Editor edits the draft.
- Variants store `hidden: Record<itemId, string[]>` for selected items. Loading writes it back onto those items;
  variants saved before this (`hidden` missing -> `null`) leave `hidden` untouched.

## Smart tags

Every item (all 9 collections) and the profile headline+bio carry `tags: {name, display, kind}[]`,
kind ∈ `technical-skill | tool-platform | domain | soft-skill | methodology | credential | language`.
Weight of a tag = number of selected items carrying it (`aggregateTags`, computed on read).

- **Hash rule** (`lib/tags/content.ts`): `contentHash` is taken over the content fields only (no dates / ids /
  isSelected). An item is *stale* when `tagsHash !== contentHash`. Changing the field list re-stales everything once.
- **Extraction** (`lib/tags/extract.ts`, `saveResumeData`): stale items go to the text model in chunks of 20,
  3 chunks in parallel, 60 s budget, JSON mode. Every chunk also carries `tagContext(data)` (headline, degrees,
  summary; not hashed) so the model can file items under the candidate's field, and the prompt asks for
  *implied* concepts ("5-service architecture" -> Microservices, a compiler project -> Computer Science as domain)
  while tools/platforms must still be named. Degrees yield the specific degree **and** the generic level
  ("Bachelor's Degree"). Libraries tagged before this rule keep their old tags until re-tagged (the Library's stale-tags notice, or `POST /api/tags/backfill {force:true}`). A failure never blocks the save: items stay stale and the
  action returns `tagWarning`. `POST /api/tags/analyze` tags draft items without persisting (live Job Match,
  uploaded resumes); `POST /api/tags/backfill` re-tags stale (or all) persisted items.
- **Normalisation** (`lib/tags/normalize.ts`): lowercase key + built-in alias table (no ambiguous short forms: `cv`, `cs`, `ms`, `ba`,
  `pg`, `tf`, bare `rest` are left alone; degree abbreviations beyond tech (BSN, BEd, BBA, LLB, MBA, MSN, JD, PharmD, DNP…) and licences
  (RN, LPN/RPN, NP, CPA, PMP, journeyman) are mapped; `BUILTIN_SATISFIERS` has licence ladders: NP satisfies RN, RN satisfies LPN,
  master electrician satisfies journeyman) (`js` -> `javascript`,
  `k8s` -> `kubernetes`, …) + model-reported aliases stored in `users/{uid}/meta/tags` (accepted only when the
  canonical is a returned tag name; built-ins never overridden). `display` keeps the pretty spelling.
- Profile tags live on `ResumeData.profileTags` (not inside `PersonalInfo`, which is treated as a flat string map).
- `glm-5.x` models reject `thinking: disabled`; the client sends `reasoning_effort` when `effort` is set
  (`"low"` ≈ 7 s per 20-item chunk on `glm-5.3-flash`).

## Security

Every route handler starts with `guardApi(req, RATE.<policy>, { ai?, feature?, what? })` (`lib/security/guard.ts`) and, when it
calls the model, wraps its body in `withAiUser(uid, task, ...)`. The guard checks, in order: same-origin for non-GET (`isSameOrigin`:
`Sec-Fetch-Site` / `Origin` vs host, the CSRF check cookie-authenticated multipart routes need), the session, the per-user rate limit,
then for `ai: true` the GLM key and the daily AI budget. Server actions get Next's own origin check; `saveResumeData` also rate-limits
(`RATE.save`) and wraps its tagger call.

- **Rate limits** (`lib/security/rate-limit.ts`): fixed windows per user per policy (`RATE`: import 12/h, job analyses 20/h,
  reconcile 20/h, tailor 20/h, proposals 20/h, skill answers 30/h, tags 30/h, backfill 6/h, review 20/h, About you 30/h, link checks
  30/h, saves 60/h, poll 30/min memory-only). Stored in the top-level `rate_limits` collection (`<policy>__<uid>`, transaction),
  mirrored in memory so an exhausted key is refused without a read; a Firestore failure falls back to the in-memory count. 429
  replies carry `Retry-After` and `{ rateLimited: true }`; `rateLimitMessage` is the server-action flavour.
- **Per-IP burst limit** (`proxy.ts`, `lib/security/memory-limit.ts`): 120/min on `/api/*`, 60/min on `/api/auth/*`, 240/min on
  `/dashboard*`, per instance. The proxy also redirects a missing session on `/dashboard` to `/login` (NextAuth's `auth()` wrapper does
  not redirect once a callback is given).
- **AI budget** (`lib/security/ai-budget.ts`): `chatCompletion` reads the `AsyncLocalStorage` context set by `withAiUser`, throws
  `GlmError(..., 429)` when the user's day (UTC) is spent and records `usage.total_tokens` (estimated when absent) into `ai_usage/<uid>_<day>`
  (`calls`, `tokens`, `byTask`, `byModel`). Defaults 2 M tokens / 400 calls; `glmErrorStatus(err)` maps the budget 429 for routes.
  `after()` callbacks re-enter the context explicitly. In production a call without context logs a warning.
- **Prompt hardening** (`lib/security/prompt.ts`): `sanitizeForPrompt` strips control / zero-width / bidi / Unicode-tag characters and caps
  length; free text is fenced (`fenceUserText`, `<<<BEGIN X>>> … <<<END X>>>`, inner delimiters defused) and structured input goes through
  `JSON.stringify`; every system prompt ends with `UNTRUSTED_INPUT_RULE`. Model output that is stored (brief, review comments and
  rewrites, proposals, bullets, requirement names, reasons) goes through `cleanModelText` / `cleanModelBlock`. Uploads are sniffed
  (PNG / JPEG / WebP magic bytes, DOCX must be a zip) rather than trusted by MIME type.
- **Input bounds** (`lib/validation/limits.ts`): `clampResumeData` on every save and every `resume` body (`readResumeBody`), FormData
  fields through `formStr` and friends, JSON bodies through `readJsonBody` (2 MB, 64–256 KB for small routes), variant pointers
  capped in `readVariantItems` / `readVariantHidden`, ≤ 200 jobs and ≤ 200 variants per user. Every client-supplied document id passes
  `isDocId` (`[A-Za-z0-9_-]{1,128}`), so a path can never be smuggled into a `doc()` call.
- **Headers** (`next.config.ts`): two CSPs. Public pages: `script-src 'self' 'unsafe-inline'`. `/dashboard*`: the same plus
  `'unsafe-eval' 'wasm-unsafe-eval' blob:`, because the typst.ts wasm glue evaluates a string on start-up (without it the preview
  dies with "Refused to evaluate a string as JavaScript", and the loader's retry then shows "already prepare uses for instances").
  Both: `frame-ancestors 'none'`, avatars from Google only, `connect-src 'self' blob: data:`. HSTS in production, nosniff,
  X-Frame-Options DENY, Referrer-Policy, Permissions-Policy, `Cache-Control: private, no-store` on `/dashboard*` and `/api/*`, no
  `X-Powered-By`. The preview never filters résumé text: a compile failure is an engine / template problem, and `ResumePreview`
  shows an "engine could not load" panel with Retry (`TypstEngineError`) separately from Typst diagnostics.
- **Firestore**: `firestore.rules` denies every client read/write on both databases (deploy with `firebase deploy --only firestore:rules`).
  `rate_limits` and `ai_usage` docs carry `expiresAt`; enable a TTL policy on that field for each collection group so they expire:
  `gcloud firestore fields ttls update expiresAt --collection-group=rate_limits --database=quikresume` (and `ai_usage`).

## Reasoning effort

`glm-5.3-flash` accepts `reasoning_effort` `low | high | max` only (`medium` is rejected, the API default is `max`). Reasoning
tokens count toward `max_tokens`, so `maxTokensFor(effort, lowLimit)` (`lib/glm/effort.ts`) raises the limit to 32K (high) / 64K
(max), and the client throws "cut off (token limit)" on `finish_reason: "length"` and logs time + tokens for high / max calls.

| task | effort | runs |
|---|---|---|
| tags, JD analysis, About you, skill answers, proposals' reconcile | low | inline |
| reconcile (`effortFor("reconcile")`) | max | background (`after()` in analyze / reconcile routes, ≤ 250 s minus the time the request already used) |
| coach review (`effortFor("review")`) | high | background route, 120 s per chunk, 260 s budget |
| Tailor plan (`effortFor("tailor")`) | high | `/api/jobs/auto-tailor`, 180 s |

Env overrides: `GLM_EFFORT_RECONCILE` / `_REVIEW` / `_TAILOR`. Routes running high / max calls export `maxDuration = 300`
(Vercel's limit). `POST /api/dev/effort-compare {task, jobId?, efforts?, ids?}` (404 in production) runs one task's real prompt at
each effort over your library and returns outputs + timings, writing nothing.

## Job Match

- `POST /api/jobs/analyze`: pasted text or an uploaded file (images transcribed with GLM-4.6V) -> text model ->
  `requirements: {name, display, kind, importance: must|nice, yearsMin}` saved in `users/{uid}/jobs`.
- **Reconcile pass** (`lib/match/reconcile.ts`, server-only): exact tag keys miss what a human sees at once, so the
  text model gets *all* requirements + the candidate's whole tag inventory + condensed items and returns, per
  requirement, `satisfiedBy` (other candidate tag keys that count: `bachelor's degree` <- `bachelor of science`,
  `microservices` <- `grpc`) and `evidence` (item ids that demonstrate it without a tag) + `reason`. These are
  stored **on the requirement** in the job doc, so the pure scorer honours them on every client-side recompute.
  Runs **in the background** at max effort (`runReconcileJob`, scheduled with `after()`) from `/api/jobs/analyze` when
  the form carries `resume` (the client sends the working selection) and from `POST /api/jobs/reconcile {jobId, resume}`
  ("Re-check with AI"; works for variants and uploads too; ignored while a run is in flight). Both return the job at once.
  State lives on `job.match {status: idle|running|done|failed, runningUntil, checkedAt, libraryHash, warning}`; `readMatch`
  turns a run past `runningUntil` into failed. While running, the job page shows a banner and polls
  `GET /api/jobs/reconcile?jobId=` (one doc read) every 5 s, then `router.refresh()`. `/api/jobs/proposals` still reconciles
  inline at low effort. Failures never block: requirements stay unchanged and the built-in hierarchy still applies.
- **Semantic evidence** (`lib/match/evidence.ts`, server-only, runs first inside `runReconcileJob`): library units
  (`lib/match/units.ts`: one head unit per item + one per bullet with "<title> at <org> (<dates>): " context) are embedded with
  Voyage (`lib/embed/voyage.ts`, voyage-4-lite @512, `document`) and cached in `users/{uid}/vecs/{itemId}`
  (`{space, hash: contentHashOf, units: [{k: bulletKey | "\0head", v: base64 Float32}]}`; re-embedded when the content hash or
  `VECTOR_SPACE` changes). Requirements (`"<display> (<kind label>)"`, `query`) and the job title are embedded per run. Cosine
  matrix -> CSLS ranking (`cslsMatrix`, penalises generic lines) -> best unit per item, top 8 -> requirements whose cosine-only p
  is in [0.15, 0.9] get `rerank-3-lite` (budget `VOYAGE_MAX_RERANK_CALLS`; a 429 stops reranking for the run, never waits) ->
  calibrated p (`probability`, Platt fit in `lib/match/calibration.json`) -> top 5 hits with p ≥ 0.15 stored as
  `requirement.semantic: {itemId, bullet, p, quote, reranked, confirmed}`; `job.titleSim` = calibrated title similarity per
  work-experience item. Uncertain hits (0.25 ≤ p < 0.9) go to the LLM reconcile as `hints`; afterwards `confirmed` = the judge
  cited that item (true), saw it and did not (false), or did not run (null). Any Voyage failure returns a warning and the job
  scores on tags alone. Free tier without a payment method = 3 requests / 10K tokens per minute (embeddings are batched).
- **O*NET categories** (`lib/match/taxonomy.ts`, data `lib/match/taxonomy-onet.json` from `scripts/build-taxonomy.mjs`, O*NET 30.0,
  CC BY 4.0, credited in the marketing footer): 4,262 software / tool categories + 34K product names (with vendor-less short
  names: "Excel", "AutoCAD"; small alias list: "Epic", "Cerner"). One direction only: a requirement whose query embedding
  (first 256 dims) is ≥ 0.6 from a category title and which is not itself a known product ("EHR software", "CRM", "CAD",
  "multimeters") is satisfied by candidate tags that are products of that category; they are merged into `satisfiedBy`
  after the reconcile pass with reason "Counts as <category> (O*NET)". Products of the same category are never treated as
  related (Java and JavaScript share one). Probe: categories scored 0.60–0.75, non-categories ≤ 0.53.
- **Selection** (Tailor plan, set cover) uses `coveredByItem`, which also counts a semantic hit with p ≥ `SEMANTIC_COVERS`
  (0.6) that the judge did not reject. Seniority is not scored numerically; JD analysis reports conflicts in `fitNotes`.
- **Calibration** (`scripts/calibration/fit.mjs`, `node --env-file=.env.local scripts/calibration/fit.mjs [extra.json]`): logistic
  fits `p = σ(a·cos + c·rerank + b)` and cosine-only on labelled pairs (`scripts/calibration/seed.json`, several professions,
  deliberate hard negatives). Features are cached in `scripts/calibration/.features.json` (gitignored). Refit whenever the
  embedding or rerank model changes (the `space` field records which). First fit (100 seed pairs, in-sample, so optimistic):
  cosine-only AUC 0.81, cosine + rerank AUC 0.957: the reranker carries most of the signal, which is why nearly every
  requirement is reranked and why a rate-limited run (no rerank) leans on the LLM judge for confirmation.
- **Coverage** (`lib/match/coverage.ts`, pure): an item covers a requirement when it carries the exact key, a
  `satisfiedBy` key, a key the built-in hierarchy accepts (`builtinSatisfiers` in `lib/tags/normalize.ts`:
  `bachelor's degree` <- any `bachelor of …` / master / doctorate, etc.), or is cited in `evidence`. Shared by
  the scorer and the set cover.
- **Scoring v2** (`lib/match/score.ts`, pure, runs in the browser; the header comment has every formula): per selected item,
  evidence e = 0.95 exact tag (binary kinds 1) / 0.9 reconcile-cited / 0.85 satisfying tag / p semantic (confirmed -> ≥ 0.9,
  rejected -> 0.4·p), × recency 0.5^(age/4y) for dated work; hidden bullets and unselected items never count. Strength
  m = noisy-OR of the top 3 (binary kinds: best e); a literal hit with nothing better = 0.5. Sub-scores: coverage
  Σw·m/Σw (w = must 1 / nice 0.4 × hard 1 / soft 0.3), ats (hard reqs printed; summary / skills / latest role = 1, elsewhere 0.6),
  years (evidenced dated spans vs `yearsMin`), title (`job.titleSim`), education (credential reqs); composite weights
  `SUB_WEIGHTS` .55/.15/.10/.10/.10 over the non-null ones. A hard must-have with m < 0.3 caps the score at `MUST_GATE_CAP` (70).
  `band` = ±95% from Σw²m(1−m); `row.gain` = exact points for fully evidencing that requirement. `missingMust` / `keywordGaps`
  use m < 0.3. UI: `components/ui/job-match/match-breakdown.tsx` (headline ± band + must-haves, sub-score bars, "What would
  raise it", evidence table with Direct / Related / Semantic / Keyword only).
- **Recommendation** (`lib/match/recommend.ts`): greedy weighted set cover (must = 3, nice = 1, a requirement
  saturates after 2 carriers) under per-section caps (`DEFAULT_CAPS`, user-editable in `meta/preferences`);
  matching skill categories always in; education never excluded. Produces include/exclude proposals.
- `POST /api/jobs/proposals`: deterministic include/exclude + text-model `rewrite-bullet | add-skill | gap`
  proposals, muted rules filtered, statuses preserved by id, stored on the job. "Ignore similar" writes a
  `{kind, tag | itemId}` rule to `users/{uid}/meta/preferences.mutedProposals`.
- Apply: include/exclude call the item's `update*` action (or edit the draft when one is open); rewrite /
  add-skill always edit the draft (`applyProposal`) and open the editor.
- **Tracker** (`?view=jobs`): jobs carry `status` (`saved|applied|interview|offer|rejected`, missing = saved), `appliedAt`
  (YYYY-MM-DD, stamped the first time status leaves "saved"), `notes`, `variantId`, and posting fields `url`, `urlKey`
  (`jobUrlKey(canonicalJobUrl(url))`, `lib/jobs/canonical-url.ts`), `location`, `employmentType`; `source.kind` may be
  `extension`. `setJobStatus` / `updateJobMeta` (`updateJobTracking`) change them; a re-import of the same `urlKey` must refresh
  posting fields only. Board drag and the status Select do the same thing (keyboard users never need the drag).
- **Job list**: `saveJobScore` writes only `lastScore` (no `updatedAt`, which orders the list) 1.5 s after the working-selection
  score changes; titles rename inline (`renameJob`); a trash button on each list row deletes.
- **The Suggestions card is hidden** (`SHOW_SUGGESTIONS = false` in `job-match-view.tsx`); the route, proposal cards and
  mute rules are kept. The job page shows requirements grouped Hard / Soft (by `requirementTier`), a Guidelines card
  (missing must-haves, keyword gaps, declined skills) and the "Tailor résumé" button (the only tailoring flow).
- `patchJob` runs `stripUndefined`: Firestore rejects `undefined` values, which used to crash the proposals route
  (proposals carry optional `section` / `current` / …) and surfaced as a generic "Could not get suggestions".

## Tailor window

```
questions (uncovered hard + soft reqs) -> window on the working selection -> (background) POST /api/jobs/auto-tailor
  -> trim to one page (browser Typst) -> highlighted suggestions -> Close | Save variant | Save variant & download PDF
```

- **One flow, suggest-only.** "Tailor résumé" (`tailor-dialog.tsx`) replaces Auto-tailor / Tailor manually and never
  navigates away from Job Match. There is no must-have gate: the route plans even when hard requirements are uncovered.
- **Questionnaire** (`skill-questions.tsx`, `POST /api/jobs/skill-answers`): asks about `uncoveredRequirements` (every
  requirement with strength 0 on the whole library, hard first). Yes on a soft requirement appends it to a printed
  "Soft skills" category; Yes on a hard one appends it to the category picked in the row, or the one the text model picks
  (`SKILL_CATEGORY_SYSTEM_PROMPT`; a new "Technical skills" category when nothing fits or the call fails). An optional
  example is worded into one bullet on the picked item. Touched items are re-tagged (30 s) and also get the answered
  requirement's tag, with `contentHash = tagsHash`, so coverage is immediate. No is stored in
  `meta/preferences.declinedSoftSkills` (hard and soft despite the name) and shown in Guidelines ("I have one now").
- **Reconcile reuse:** `/api/jobs/auto-tailor` skips its own pass when `job.match` is done and `reconcileLibraryHash`
  (requirements + tag inventory + items + brief, selection-independent) matches the library sent; otherwise it reconciles
  inline at low effort (45 s). The tailor call itself runs at high effort (180 s).
- **Plan** (`lib/match/auto-tailor.ts`, pure): items covering a hard requirement (plus the newest education) are
  *locked*; the rest follow `recommendSelection` over the soft requirements. Lines that literally name a hard requirement
  are *protected* (`protectedBy` records which). The text model (`AUTO_TAILOR_SYSTEM_PROMPT`) confirms or flips unlocked
  decisions and may hide unprotected bullets / skills; `mergeAiReview` ignores anything touching a locked include, a
  protected line, an unknown id or index. AI failure -> tag-based plan with a warning.
- **Suggestions, not decisions:** the window edits a `TailorSelection` that starts as the working selection. The plan is
  trimmed (`fitToOnePage`: bullets of weak unlocked items, then those items, then unprotected bullets of locked items; the
  first bullet stays) and `diffSuggestions(plan, target, base)` lists every difference with a reason. Pending ones are
  outlined with Accept / Dismiss, plus Accept all; toggling by hand to match clears them. "Allow more than one page" swaps to
  the untrimmed suggestions; "Fit to one page" trims the current selection directly.
- **Overrides:** locked items and protected lines can be switched off; `overrideWarnings` explains why not in yellow
  (the only item covering a hard requirement, a hidden ATS keyword, no education left).
- **Buttons:** Close (also Escape / backdrop) writes the selection onto the working selection (`applyWorkingSelection`,
  skipped when unchanged), so reopening starts where you left off. Save variant -> `createVariantFromPlan` (writes and
  loads the variant). Save variant & download PDF compiles the PDF first, then saves and downloads. Both saves need one
  page or the multi-page tick; Close never does. A Preview toggle swaps the list for the Typst preview.

## Browser extension

`extension/` is its own WXT + React + TS project (Chrome MV3; `cd extension && npm install`, `WXT_APP_URL=http://localhost:3000
npm run dev`, `npm run build` -> `.output/chrome-mv3`, `npm test` for the jsdom extraction tests). The root tsconfig / eslint ignore it.

- **Pairing** (`lib/ext/tokens.ts`): `/dashboard/extension` (`ExtensionPanel`) calls `createExtensionCode` (8 chars, no 0/O/1/I/L,
  10 min, single use, stored as sha256 in top-level `extension_codes/{hash}` with `expiresAt`). Click-to-connect: the page posts
  `{source: "quikresume-app", type: "pair", code}` (`lib/ext/bridge.ts`); the extension's `site.content.ts` (only on the app origin)
  forwards it to the background, which redeems it at `POST /api/ext/pair` and stores the token. Fallback: the code is shown and
  typed into the side panel. Tokens `qr_<43 base64url>` are stored only as sha256 in `extension_tokens/{hash}`
  (`uid, deviceName, prefix, createdAt, lastUsedAt`), ≤ 10 per user, revoked from the page or by the extension's Disconnect;
  verified tokens are cached 30 s per instance. Enable a TTL policy on `extension_codes.expiresAt` like `rate_limits`.
- **API** (`src/app/api/ext/*`, every handler starts with `guardExtension` from `lib/security/ext-guard.ts`: Bearer token,
  per-user rate limit, AI budget for AI routes, no same-origin check (no cookies), CORS only for `chrome-extension://<EXTENSION_IDS>`
  (any extension origin outside production when unset), web-page origins rejected): `pair`, `me`, `signout`, `jobs` (GET `?url=`
  lookup, POST import), `jobs/[id]` (GET summary, PATCH `{status, variantId}`), `variants` (résumé picker), `tailor` (quick tailor,
  see below), `tailor/save`. Import canonicalises the URL; a known `urlKey`
  refreshes url / location / employment type only; a new posting goes through `analyzeAndSaveJob` (`lib/match/analyze-job.ts`,
  shared with `/api/jobs/analyze`) with `source.kind: "extension"` and a background reconcile against the whole library.
- **Summary** (`lib/ext/match-summary.ts`): scored server-side with the same `scoreJob` on the job's `variantId` variant, else the
  working selection. Library getters authenticate through `currentUid()`; `asUser(uid, fn)` (`lib/db/session.ts`,
  AsyncLocalStorage, server-only) lets token-authenticated code reuse them.
- **Extension side**: `lib/extract.ts` (site adapters -> JSON-LD `JobPosting` -> readable-text heuristic; `postingUrl` turns
  LinkedIn / Indeed / Glassdoor list panes into the posting URL), `lib/detector.ts` (re-checks on SPA URL changes / DOM settles,
  reports to the background, mounts the bouncing floating button from `lib/fab.ts` in a closed shadow root; per-site dismiss in
  `fabHidden`, global `fabEnabled`), `job.content.ts` on `lib/sites.ts`, `scan.content.ts` (runtime registration, injected by
  "Scan this page" via activeTab), `background.ts` (token, per-tab state in `chrome.storage.session`, badge: `•` detected / score
  saved), side panel (`entrypoints/sidepanel`: connect, save & match, score ± band, must-haves, what would raise it, status).
  The footer always reads "AI can make mistakes please review the work before applying."
- **Auto Fill** (side panel button -> background injects `fill.content.ts` into every frame, runtime registration): `lib/fields.ts`
  scans controls (radio groups merged; labels from `aria-labelledby`, `<label for>`, wrapping label, `aria-label`, a wrapper holding
  only that control, placeholder), `classify`s them by regex rules over label + name / id / autocomplete (long question-like labels on
  fact fields become `"question"`), fills empty ones only (native value setter + input / change / blur so React inputs register;
  `matchOption` for selects / radios incl. yes/no and "decline" synonyms), attaches the résumé PDF through `DataTransfer`, sends open
  questions to `POST /api/ext/autofill/answers`, outlines filled fields (solid) and AI drafts (dashed), and reports counts + fields left
  for the user (also stored as `unmapped` on Autofill preferences). Never submits; checkboxes (consent) are never ticked.
- **Quick tailor** (side panel, `POST /api/ext/tailor {jobId}`): starts from the job's résumé (`resumeForJob`), runs `runTailorPlan`
  (`lib/match/tailor-run.ts`, shared with `/api/jobs/auto-tailor`), trims with `fitToOnePage` using `countResumePages`
  (`lib/typst/server-pdf.ts`, native SVG compile, ~20 ms) and returns `diffSuggestions` + before / after scores. The panel ticks
  suggestions (`applySuggestions` in `extension/lib/types.ts`); `POST /api/ext/tailor/save` stores the result through
  `createVariantFromPlan({ load: false })` (the working selection is untouched) and links it as the job's `variantId`. The picker
  ("Résumé for this job") PATCHes `variantId`; changing it drops a stale tailor run.
- **Autofill preferences** (`/dashboard/autofill`, `meta/autofill`, `lib/autofill/types.ts` `readAutofillPrefs` clamps everything):
  address, salary (min / target / currency / period), notice period, earliest start, work authorised / sponsorship / relocation
  (prefilled from About you when empty), EEO answers (default "Decline to answer"), "how did you hear", saved answers (used word for
  word when a question matches, `savedAnswerFor`), agent instructions (the user's own rules for AI answers), unmapped fields.
- **Server routes**: `GET /api/ext/autofill/profile?jobId=` (contact details, latest role / school by date, years, prefs, résumé
  source), `POST /api/ext/autofill/answers` (`AUTOFILL_SYSTEM_PROMPT`, low effort: résumé text + brief + instructions + saved answers
  + posting; facts only from the input, options verbatim or "", never answers protected-characteristic questions, `RATE.autofill`),
  `POST /api/ext/autofill/unmapped`, `GET /api/ext/resume/pdf?jobId=` (`lib/typst/server-pdf.ts`: native
  `@myriaddreamin/typst-ts-node-compiler` 0.7.0, same templates + fonts; `serverExternalPackages` + `outputFileTracingIncludes` in
  `next.config.ts`).

## Guest funnel (/start)

`/start` (public; signed-in visitors are sent to `?view=import`) runs `StartFlow`: import (`POST /api/guest/import`, the /api/import
contract + `turnstile`) or a sample from `lib/demo/samples.ts` -> field + target role -> template (the real `ResumePreview`, so `/start`
gets the dashboard's eval-enabled CSP plus Turnstile's script / frame / connect origins) -> paste a job (`POST /api/guest/match`: JD
analysis + tagging the draft in parallel, low effort, no candidate brief, no reconcile, no embeddings) -> teaser (score, must-haves,
blurred rows) -> Google sign-in (`signInFromStartAction`, back to `?view=jobs`).

- **Nothing server-side** until sign-in: the draft lives in `localStorage["quikresume.guestDraft"]` (`lib/guest/draft-store.ts`).
  `<GuestClaim>` in the dashboard layout calls `claimGuestDraft` once: an uploaded résumé is saved through `saveResumeData` only when the
  library is empty (profile fields only fill blanks), the matched job is created from its stored requirements (clamped; no second
  analysis), then the store is cleared and a notice links to the job. Samples are never claimed into the library.
- **Guard** (`lib/security/guest-guard.ts`, `guardGuest`): same-origin, GLM configured, per-visitor durable rate limit (`RATE.guestImport`
  4/h, `guestMatch` 6/h, keyed by `guest-<sha256(AUTH_SECRET|ip)>`, never the raw IP), Turnstile (`lib/security/turnstile.ts`), then the
  guest AI budget: `withAiUser(guestId, task, fn, { budget: GUEST_BUDGET, pool: GUEST_POOL })`; `chatCompletion` checks both and
  `recordAiUsage` records both (`ai_usage/guest-pool_<day>` is the global guest pool).
- The teaser is a keyword-level first read (tags only); the full review after sign-in adds the reconcile pass and semantic matching.

## About you (characterization)

`users/{uid}/meta/characterization`: the candidate's goals and background, condensed into a **candidate brief** that coaching
and tailoring prompts receive.

- **First run**: `dashboard/page.tsx` redirects to `/dashboard/about?first=1` when there is no doc at all, and only when `?view` is
  absent (a revalidation while the editor is open never navigates). Opening the page marks it seen (`status: "skipped"`, so the
  redirect happens once); a yellow nudge on the Library links back until `status === "complete"` (dismissal in sessionStorage).
- **Answers** (`lib/about/types.ts`): Core (field, years of experience, education status + graduation, target roles), Targeting
  (level, industries, locations, work modes, relocation, work authorization), Your story (career change, gaps, strengths,
  emphasize / play down), plus 3–5 AI follow-up questions. No style preferences.
- **Prefill** (first visit): dates-based facts at once (`lib/about/facts.ts`: `yearsOfExperience` merges overlapping jobs and
  excludes internships, `educationStatusOf`, `employmentGaps` counted from the first non-internship job), then
  `/api/about/prefill` suggests field / roles / level / industries / strengths / career change (never location or authorization).
  Suggested fields are marked until edited. Follow-ups regenerate only when `coreHash(answers)` changes.
- **Brief**: `/api/about/save` with `status: "complete"` writes it (plain text, `capBrief` ≤ 1500 chars) when `answersHash` differs
  from `briefHash`; a failure keeps the old brief and sets `briefStale`. Saving a draft never downgrades a complete doc.
- **Prompts**: `readCandidateContext(uid)` (server-side, never sent by the client; null without a brief) feeds JD analysis,
  reconcile, proposals, auto-tailor, skill-bullet wording and the item review, as `candidate` via `candidatePayload`. Every such
  system prompt appends `CANDIDATE_CONTEXT_RULE`: context for relevance and level, never evidence, never printed. Tags and import
  do not get it. JD analysis also returns `fitNotes` (seniority / location / sponsorship conflicts) shown in Guidelines.

## Item review (AI career coach)

Every item (all 9 sections) and the profile headline + summary get `review: { score 0–10, flags[], comment, suggestions[{ id, field,
current, proposed, reason }], dismissed[], reviewHash, briefHash, reviewedAt }` (`users/{uid}.profileReview` for the profile).

- **Hash rule**: stale when `reviewHash !== contentHashOf(...)` / `profileHashOf(...)`, the same hashes as smart tags, computed on the
  editor model (`lib/review/content.ts`). `tagFieldsOf` returns `review`, so every Library row carries it.
- **Runs** (`/api/review/run`, `lib/ui/review-runner.ts`): fire-and-forget, never awaited by a save. Kicked after Save & Exit,
  by a Library effect keyed on the sorted stale ids (each set attempted once per session), by Re-review on a row, and by
  "Re-review N" (reviews written against an older brief; confirm first, loops while `remaining > 0`). A brief change never
  re-reviews on its own. The route takes a per-user lock (`meta/review.runningUntil`, 409 when busy; the client retries once),
  reviews ≤ 24 items per request (selected first) in chunks of 6, 2 in parallel, high effort, 260 s budget (the client waits 60 s on 409), and re-tags items in the batch whose
  tags went stale outside a save (Library accepts don't run the tagger).
- **Prompt / parse** (`lib/review/prompt.ts`, `parse.ts`): calibrated score anchors, fixed flag ids, ≤ 3 suggestions whose `current`
  is copied verbatim (one bullet, or the whole field). The parser drops suggestions for unknown fields, a `current` not in the
  item, empty / unchanged / bracketed rewrites, and rewrites that add digits the original didn't have (brief digits allowed in
  profile rewrites).
- **UI**: `ScoreBadge` on the collapsed Library row (greyed when stale), `ReviewPanel` in the expanded row with Accept (the section's
  `update*` action with `applySuggestionFormData`; a reworded hidden bullet stays hidden) and Dismiss (`dismissReviewSuggestion`,
  arrayUnion). Read-only badge + panel in editor rows and the summary; Profile page panel accepts through `updateProfileFields`.
  Up-to-date reviews scoring ≤ `LOW_SCORE` (5) are listed in Action items.
- `updateSkill` accepts `category` / `items` so skill suggestions can be applied.

## Contact & links

- `lib/contact/normalize.ts` (pure, run on blur in `ContactInput`, again in both save actions, and on import): email must be
  `local@domain.tld` (the only check that blocks a save: "Fix email" in the editor TopBar); phones with 10 digits (or 11 starting
  with 1 / `+1`) become `(123) 456-7890` (+ ` x123`), other `+` numbers and national numbers starting with 0 (9–12 digits, UK / AU /
  EU style) are kept with a note, anything else warns; LinkedIn ->
  `https://www.linkedin.com/in/<slug>`, GitHub (`@user`, URL, repo URL) -> `https://github.com/<user>`, websites get `https://`.
- **Link checks** (`/api/profile/check-links`, kicked after a Profile save or an editor save that changed a link): LinkedIn is
  never fetched (format only, `format-ok`); GitHub via `api.github.com/users/<name>` (optional `GITHUB_TOKEN`); websites get a
  HEAD (GET fallback on 403 / 405 / 501) over `node:http(s)` with a DNS `lookup` guard refusing private / loopback / link-local /
  CGNAT addresses on every hop, ports 80 / 443, ≤ 3 redirects, 5 s timeout. Results on `users/{uid}.linkChecks` (24 h cache per URL,
  10 s throttle). Only `not-found` (404 / 410 / no such domain) shows the red mark, and only while the field still holds that URL.

- **Extra links** (`lib/contact/links.ts`, `ResumeData.links`, `users/{uid}.links`, ≤ 6 `{label, url}`): portfolio, ORCID, Behance…
  Edited with `LinksEditor` in the editor's personal info card and on the Profile page (`updateUserProfile(info, links)`; omitted =
  unchanged), normalised like the website field and de-duplicated by URL. Printed after LinkedIn / GitHub / website as
  "Label: url" (a bare URL when unlabelled) in every template (`header.links`). Import fills them (`links` in the JSON shape,
  unioned by `mergeLinks`); the link check stores their results on `linkChecks.extra` (`brokenExtraLink`); Autofill uses a
  "Portfolio"-labelled link for portfolio fields and the first link when there is no website.

## Resume import

```
file --(browser)--> PDF? render pages to JPEG with pdf.js : send as-is
     --POST /api/import (multipart)--> DOCX -> mammoth text | TXT -> text | images -> image_url parts
     --> GLM-4.6V (SYSTEM_PROMPT in lib/import/prompt.ts) --> JSON text
     --> parseModelOutput (lib/import/parsed-resume.ts) --> { data: ResumeData (tmp ids), warnings }
     --> review step (resume-import.tsx) --> mergeImport into the editor draft --> user clicks Save & Exit
```

- Nothing is persisted by the import itself; the draft goes through the normal `saveResumeData` path.
- It is a Route Handler, not a server action: server actions cap bodies at 1 MB and the route needs
  `maxDuration = 120` (GLM calls take 10–60 s). It calls `auth()` itself (`proxy.ts` only guards `/dashboard`).
- **GLM facts (verified live):** `glm-4.6v` accepts `text` and `image_url` parts (URL or data URI, ≤ 5 MB each).
  `file` parts are rejected by every model, and `response_format: json_object` is text-model only, which is
  why PDFs are rasterised in the browser and JSON is extracted from the reply with a balanced-brace scan.
- Parsing is lenient on purpose: the envelope never fails, each item is validated on its own with zod, and
  rejects go into `warnings` (shown in the review step). Dates like `2021`, `Jan 2021`, `03/2021`,
  `Spring 2020`, `Present` are normalised in `lib/import/dates.ts`.
- Duplicates are found by `findMatch` (`lib/import/match.ts`, fuzzy, deterministic): `canon` lowercases, strips accents /
  punctuation, expands abbreviations (Sr., B.S., Ph.D.…), drops company suffixes (`canonOrg`) and treats save placeholders
  (`PLACEHOLDER` in `lib/sections.ts`: "Unknown Company", "General"…) as empty; titles match on token Dice ≥ 0.8; work
  experience also needs the same start *year* (or a missing one). The review labels against `draft ?? initialResumeData`,
  the same base the merge uses.
- `mergeImport` appends new items and **merges** duplicates: bullets and skill lists are
  unioned, empty scalar fields filled. The review step labels rows New / Adds detail / Already in library.
  Several files can be queued in one session (`combineParsedFiles` dedupes across files). Personal info fills
  only empty fields unless the user ticks "Replace my existing details".
- Prompt tuning lives in `lib/import/prompt.ts`; skill grouping (3–6 categories when the resume lists
  skills flat) and section routing (Awards/Volunteering/Publications/Languages) are instructed there.

## Typst pipeline

```
ResumeData --toTypstDoc()--> TypstResumeDoc (JSON) --sys.inputs.resume--> main.typ --> templates/<id>.typ render(data)
```

- `toTypstDoc` (`src/lib/typst/doc.ts`) is the **only** place data is shaped for Typst: it orders items (`orderedItems`),
  filters `isSelected` and `hidden` sub-items, formats date ranges, splits bullets, adds `layout` and per-entry layout fields,
  and guarantees every field is a string or array (never null). `renderedText` (ATS check) skips `layout`. Templates are pure styling: they do no filtering or date logic and never receive markup.
  User text is displayed as plain strings, so `# * _ $ [ \` etc. need no escaping.
- `src/lib/typst/client.ts` lazily inits typst.ts once (wasm via URL from `/typst/wasm`, default remote
  font assets disabled, Inter preloaded, `main.typ` + templates registered with `addSource`), and
  serializes all compiles through one promise chain (the wasm is single-threaded).
  `compileSvg` -> preview, `compilePdf` -> download. Browser only: `ResumePreview` is loaded with
  `next/dynamic({ ssr: false })`.
- `ResumePreview` keys its effect on `JSON.stringify(doc)` and debounces 300 ms; it keeps the last good
  SVG visible while recompiling and shows Typst diagnostics on error.
- **Adding a template:** write `public/typst/templates/<id>.typ` exporting `#let render(data) = { ... }`;
  import it in `public/typst/main.typ` and add it to the `templates` dict; add an entry to
  `TEMPLATES` in `src/lib/typst/templates.ts`. Import shared helpers with `#import "/lib/theme.typ": ...` (root-absolute
  path: the CLI uses `--root public/typst`, the browser registers `TYPST_LIBS` at the same paths) and start `render` with
  `resolve(data, accent: ..., heading-font: ..., body-font: ...)` so the user's accent / font pair / paper apply. Never name a
  parameter `h` (shadows Typst's `h()` spacing). Section heading blocks use `sticky: true` so a heading never ends a page.
- **Theme** (`lib/layout/theme.ts`, on `ResumeLayout.theme`, normalised by `normalizeLayout`): `templateId`, `accent`
  (`ACCENTS`, `"template"` = the template's own), `font` (`FONT_PAIRS`: heading + body family), `paper` (`a4 | us-letter`).
  `toTypstDoc` passes `layout.theme = { template, accent: "#hex" | "", heading_font, body_font, paper }`; `compileSvg` /
  `compilePdf` default to `doc.layout.theme.template`. Saved with the working layout (Preview toolbar -> `updateLayout`, or the
  editor draft while the editor is open), so variants snapshot it; `createVariant*` also write `templateId` from it.
  Every font family a pair can name must be in `FONT_URLS` (`lib/typst/client.ts`) and `public/typst/fonts`.
- **Page sheets**: typst.ts renders all pages into one SVG (`g.typst-page`, `transform="translate(0, y)"`,
  `data-page-width/height`). `svgLayout` (`lib/typst/pages.ts`) reads those boxes and `ResumePreview` shows each page as its own
  clipped window onto the same SVG, with a gap and "n / N". A template should iterate `data.layout.order` and honour the page /
  section / entry layout values (see `render` and `stack-entries` in `ledger.typ`, which fall back to defaults when absent).
  Section macros in `ledger.typ`
  (`header`, `summary`, `education`, `skills`, `projects`, `experience`, `certifications`) are the
  reference for what each section receives.

`TypstResumeDoc` fields:

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
| `custom[]` | `{ heading, entries: [{ title, organization, date, bullets[] }] }`: one group per heading, printed at the `"custom"` slot of `order` |
| `layout` | `{ order: sectionKey[], page: { margin (mm), size (pt), leading (em) }, sections: { <key>: { above, below, gap, indent } } }` |

Every list entry also carries `space_after` (pt), `break_before`, `keep` (entries are unbreakable unless `keep` is false).

## Data model (Firestore)

`users/{uid}`: `firstName, lastName, headline, professionalEmail, phoneNumber, location, github, linkedIn,
website, bio, links, profileTags, profileContentHash, profileTagsHash, profileReview, linkChecks, linkChecksAt, loadedVariantId, updatedAt`
(+ NextAuth adapter fields such as `email`, `image`).

Subcollections, each item doc has `isSelected`, `tags`, `contentHash`, `tagsHash`, `review`, `createdAt`, `updatedAt`:

| collection | fields |
|---|---|
| `experience` | `position, company, startDate, endDate, isActive, description: string[], hidden: string[]` |
| `education` | `schoolName, programName, startDate, endDate, isActive, gpa, minorName, details, locationCity?, locationProvince?, locationCountry?, doubleMajor?` |
| `skills` | `category, items, hidden: string[]` |
| `projects` | `title, stack, link, startDate, endDate, isActive, description: string[], hidden: string[]` |
| `certifications` | `name, issuer, year, credentialId, expires` (certifications and licences; number + expiry print as "Issuer · No. X" / "2019 · exp. May 2027") |
| `awards` | `title, issuer, date, description` |
| `volunteering` | `role, organization, startDate, endDate, isActive, description: string[], hidden: string[]` |
| `publications` | `title, venue, date, link, authors` |
| `custom` | `section, title, subtitle, startDate, endDate, isActive, description: string[], hidden: string[]` (entries of user-named sections; ordered by `createdAt`) |
| `languages` | `language, proficiency` |
| `variants` | `name, labels: string[], items: {experience: string[], …}, hidden: {itemId: string[]}, layout: ResumeLayout \| null, templateId` (pointers only) |
| `jobs` | `title, company, source, jdText, summary, requirements[] ({name, display, kind, importance, yearsMin, satisfiedBy[], evidence[], reason}), match ({status, runningUntil, checkedAt, libraryHash, warning}), proposals[], proposalsAt, lastScore, fitNotes[], status, appliedAt, notes, variantId, url, urlKey, location, employmentType` |
| `vecs` | `space, hash, units: [{k, v}]`: cached embeddings per item id (see Semantic evidence); deleted with the item |
| `meta/tags` | `aliases: Record<alias, canonical>` |
| `meta/characterization` | `status: draft \| skipped \| complete, answers, followUps[], followUpsHash, answersHash, brief, briefHash, briefAt, briefStale, facts` |
| `meta/review` | `runningUntil, lastRunAt` (review lock) |
| `meta/layout` | `sectionOrder, itemOrder, page, sections, items` (see Layout and order) |
| `meta/autofill` | Autofill preferences (see Browser extension): `address, salary, noticePeriod, earliestStart, workAuthorized, needsSponsorship, willingToRelocate, eeo, howDidYouHear, answers[], agentInstructions, unmapped[]` |
| `meta/preferences` | `mutedProposals: {kind, tag?, itemId?}[], caps: Record<ResumeListKey, number \| null>, declinedSoftSkills: {name, display, at}[]` (hard + soft) |

Top-level (not per user): `rate_limits/{policy}__{uid}` (`count, windowStart, expiresAt`) and `ai_usage/{uid}_{YYYY-MM-DD}`
(`calls, tokens, byTask, byModel, expiresAt`); see Security.

Dates are stored as Firestore `Timestamp` at **UTC midnight** (`toUtcDate`), month precision (day 01). In the editor model
`startDate` is `"YYYY-MM-01" | ""` and `endDate` is `"YYYY-MM-01" | "Present" | ""`; `"Present"`
round-trips to `isActive: true` / `endDate: null`. `description` is newline-separated bullets in the
editor and `string[]` in Firestore.

## Conventions

- `"use server"` modules export only async functions and `export type` re-exports; every action
  checks `session.user.id` and scopes reads/writes to that user.
- Parse dates by parts with `src/lib/dates.ts`; never `new Date("YYYY-MM-DD")` (UTC parse shifts the
  month in negative-offset time zones).
- No `setState` from props inside effects; key effects on primitive strings; no manual `useMemo`/`useCallback`
  (React Compiler handles it).
- Optional strings are stored as `null`, not `""`. Mappers default missing fields to `""`.
- Light + dark themes come from the tokens only: `:root` and `:root[data-theme="dark"]` in `globals.css`; never `dark:` variants.
  `data-theme` is set before first paint by `THEME_SCRIPT` in `app/layout.tsx` from `localStorage["quikresume.theme"]`
  (`lib/ui/theme-store.ts`: light | dark | system; the sidebar footer toggle) or the OS. The résumé sheet is always `bg-paper`.
  The accent is the brand green (#003200 light / #5fd38a dark): primary fills only; `accent-text` for links / active nav /
  score; scores are one green plus a word band (`scoreBand`), never red/amber/green by value. Colours go through the tokens
  (`bg-surface`, `text-fg-muted`, `border-border`, `text-danger`…), never raw palette classes; no `font-black`, no uppercase micro-labels, radii ≤ `rounded-lg`,
  shadows ≤ `shadow-sm`. New UI is built from `components/ui/primitives`.
- Browser-persisted UI state (preview pane, expanded rows) uses the `createPersistedStore` + `useSyncExternalStore` pattern
  in `lib/ui/persisted-store.ts` (server snapshot = initial) rather than reading storage in effects.

## Gotchas

- Background writers (review run, tag backfill, link checks, dismiss) use `update()`, never `set(..., { merge: true })`: a merge-set on
  an item deleted while the model ran recreates it as a fields-only document. Ignore NOT_FOUND (`code === 5`).
- `useResumePageCount` returns `{ pages, error }`; show the error instead of an endless "…".
- Fetches to route handlers go through `readJson` (`lib/ui/fetch-json.ts`): platform timeouts return HTML, not JSON.

- Firestore `orderBy(field)` silently drops documents missing that field. `experience`/`education`/`volunteering`
  order by `startDate`; `projects`/`certifications`/`awards`/`publications`/`languages` order by `createdAt`.
  Always write the ordered field.
- Batch writes are capped at 500; `saveResumeData` chunks at 450.
- The compiler wasm is ~27 MB (~7 MB over the wire). It loads only when the preview mounts.
  `public/typst/wasm` is gitignored; if it is missing, run `npm install` (postinstall) or the copy script.
- Typst 0.13: use `json(bytes(str))`, not the removed `json.decode`. Inter has no CJK/emoji glyphs; enable
  `TypstSnippet.preloadFontAssets({ assets: ["cjk"] })` in `client.ts` if that is ever needed.
- `sys.inputs` values are strings; `main.typ` falls back to `sample.json` only when no `resume` input is given.
- `next/dynamic({ ssr: false })` is only allowed inside Client Components (as done in `dashboard-client.tsx`).
- `useSearchParams` needs a `<Suspense>` boundary: `DashboardClient` and `SidebarNav` wrap themselves.
- The preview side pane (≥1280px, `PanelRight` toggle / sidebar "Preview") is rendered by `DashboardClient`, not the layout,
  because only it has `resumeData`. Below 1280px "Preview" navigates to `?view=preview`. Its width is resizable
  (`clamp(360px, stored, 50%)` as the grid column, stored in localStorage); views that lay out columns inside the
  remaining space (Job Match) use Tailwind container queries (`@container`, `@4xl:`), not viewport breakpoints.
- `"use server"` files may only export async functions, so shared Firestore boilerplate lives in
  `src/lib/db/user-collection.ts` (plain `server-only` module); never build actions with a factory.
- Route handler files may only export route fields (`GET`, `POST`, `runtime`, `maxDuration`, …); shared
  constants/types for `/api/import` live in `src/lib/import/types.ts`.
- `dashboard/page.tsx` exports `maxDuration = 120` because Save & Exit (a server action) now calls GLM; actions
  inherit their page's segment config. Long GLM calls otherwise live in route handlers.
- `variants` and `jobs` order by `updatedAt` (always written). `readJobs` (the dashboard list) projects with `select()` and leaves
  `jdText` out (`""` on the record); `readJob` returns it.
- `set(..., { merge: true })` treats a dotted key as a literal field name; only `update()` reads `"a.b"` as a path. Nested increments go
  in as nested maps (see `recordAiUsage`).
- `applyVariantSelection` reads `isSelected` + `hidden` first and writes only documents that change; `readVariant` is one document read.
- Testing server-only modules outside Next: alias `server-only` to an empty module (a `--require` shim) and load `.env.local` with
  `node --env-file`; `lib/security/*` and `lib/validation/limits.ts` (pure parts) run under plain `tsx`.
- ESLint ignores `public/pdfjs/**` and `public/typst/wasm/**` (vendored bundles).
- No `typst` CLI locally: `pip install typst` in a venv gives `typst.compile(...)` with `sys_inputs`, which is
  enough to check the templates against `sample.json`.
- `schema.ts` imports `defaultLayout` from `lib/layout/presets.ts`, so `presets.ts` must not import values from
  `@/types/schema` (types only) or the modules form a runtime cycle.
- Nested `SortableList`s (sections containing item lists) are separate `DndContext`s; only handles start a drag, so row
  toggles and inputs keep working. Single-section tabs still wrap rows in a `SortableList` (useSortable needs a context).
