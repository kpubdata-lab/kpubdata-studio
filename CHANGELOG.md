# Changelog

## [Unreleased]

### Added

- CI compares Studio's response schemas with Builder's contract (kpubdata-builder#693). For every contract schema Studio mirrors by name, a contract enum value Studio does not accept, or a key Studio requires that the contract does not define, fails the `Builder contract drift` job, which the CI gate requires. It reads the contract from Builder's main; locally, set `BUILDER_CONTRACT` to run it.

### Fixed

- A cancelled run's event timeline parses again, and fetch progress is accepted (builder#648). The event-name schema lacked `run_cancelled`, which Builder has emitted for a cancelled async run since builder#481, so every cancelled run's timeline failed to parse. It now also accepts `source_fetch_progress`, which Builder emits after each `param_grid` combination.

### Added

- Connections shows **where to apply** (#412): every source dataset the catalog marks as needing an application, grouped by the page where the application is made — one application can unlock several — with a direct link, the provider's daily cap and a guide to moving to an operational account on data.go.kr. A cap the spec does not state, and today's usage (KPubData Engine does not count calls per key), read as unknown, never zero; datasets whose catalog entry says nothing about an application are counted as unknown, not "not needed". The catalog's `quota` is optional until KPubData Engine sends it (kpubdata-builder#778).
- The visual identity is written down in `docs/brand/VISUAL_IDENTITY.md` (#425): the `KPubData` wordmark leads and `Studio` is a weaker suffix, brand and status colours are separate tokens (warning, stale and partial share amber and differ by label), SQL and identifiers are always monospace, and density comes before marketing type. Five static warehouse prototypes — Home, Catalog, Tables, Table Detail, SQL Workspace — live in `docs/prototype/warehouse/` with desktop and 390px screenshots, awaiting prototype review before the app adopts them. A test fails if a status token takes a brand colour or a prototype badge carries no word.
- Studio says when it is talking to a Builder from another release (#430). It compares its own build version with the `version` that `GET /version` reports: a minor or major difference shows one dismissible banner line and blocks nothing, a patch difference passes with a console note, and a Builder that does not report `version` gets no warning. The `api_version` contract check is unchanged and separate.

### Security

- The repository no longer tracks `.next/` and `next-env.d.ts` — 229 files of Next.js build output committed by accident with #402, in a project built with Vite (kpubdata-builder#691). A new `Security` workflow runs `npm audit` over `package-lock.json`, gitleaks over the full history and CodeQL, on every pull request and weekly; the history's reviewed findings (that build's per-build Next keys, and synthetic keys in redaction tests) are listed with their reasons in `.gitleaksignore`.

### Changed

- The sidebar follows the warehouse IA (#423): **Home**, **DATA** (Catalog, Tables), **ANALYZE** (Workspace, Reports), **OPERATE** (Refresh Jobs, Quality, Monitoring), then Connections and Settings. Creating a table is an action, not a destination — the global New Build button and the Add Data menu item are gone; Catalog and Tables offer **Create Table**, Table Detail offers **Refresh**. The topbar shows a breadcrumb of where you are instead of repeating the product name and tagline. URLs are unchanged.
- Studio speaks the warehouse vocabulary of kpubdata's TERMINOLOGY.md (#422). A catalog origin is a **Source Dataset**, a built output is a **Table**, one run's output is a **Snapshot** and its files are **Snapshot Files**; an execution is a **Run**. The New Build and Add Data wizards say **Create Table**, never Refresh — only the edit mode, which re-runs an existing spec, says **Refresh**. 254 ko/en locale keys and the on-screen literals of Dataset Detail, Table Catalog, Runs, Publish, Quality, Reports, Workspace, Home and Monitoring. Korean uses 소스 데이터셋 · 테이블 · 스냅샷 · 갱신. `BuildSpec`, URLs and code names are unchanged. A test fails if a locale value says Artifact, uses Dataset without a qualifier, or calls table creation a Refresh.
- Studio calls the execution engine **KPubData Engine** wherever a user reads it (#424): `Builder API` → `Engine API`, `Builder catalog` → `Engine catalog`, and so on, across all 88 ko and 88 en locale values that named it and seven on-screen literals (Monitoring, Settings, Publish readiness, run errors, Workspace source, Dataset Detail and report export tags). Korean particles follow the new name (`Builder는` → `KPubData Engine은`). The repository, package, environment variables and code identifiers keep `builder`. A test fails if a locale value says `Builder` again.
- Ask KPubData is a feature you open from where you are, not a place of its own (#421). The sidebar has no AI group (Reports moves to the workspace group), Home has no Ask KPubData hero, and Dataset Detail has no AI tab: an **Ask about this table** header action — and the Data Passport link — writes the run, source and stage to the URL and opens the drawer with that context. A saved `?tab=ai` link opens the drawer the same way and drops the tab. `/assistant` still works.
- `git clone && npm ci && npm test` works on a fresh machine (#431). `.nvmrc` names the Node major to use and a repository-scoped `.npmrc` pins npm to the registry the lockfile resolves from, so a machine-wide corporate feed no longer breaks the install. A test fails if either drifts from `engines` or the lockfile.
- Released together with kpubdata-builder 0.4.1, which moves to kpubdata 0.7 for its security fixes. Builder and Studio share one version (kpubdata ADR 0004).
- Ask KPubData moves from `/kubi` to `/assistant`, and its stored values drop the old name: report blocks are `ASSISTANT_INTERPRETATION` and the inbox key is `kpubdata-studio:assistant-report-inbox`. No redirect or migration is kept — no deployment used the old names (#449).
- A URL naming a run older than the newest page of the runs list now opens, instead of being called invalid (#418). Dataset Detail and Quality ask Builder for that run directly (`GET /datasets/{dataset_id}/runs/{run_id}`, API contract 1.31.0), and tell a run that is not this dataset's (not found) from one that is another user's (forbidden) and from a failed check.
- Accept Builder API contract 1.30.0's column `logical_type` and `wire_encoding` (builder#735). Stage detail's column info is a strict schema, so without this a 1.30.0 Builder's silver stage detail failed to parse. Columns sent as `decimal_string` stay exact text. The fields are optional, so an older Builder still works.

## v0.4.0 — 2026-09-28

### Added
- **Authentication S1-S10**: apiFetch auth injection (#186), Google GIS sign-in (#187), token storage (#188), expiry handling (#189), sign-in gate (#190), Settings status (#191), contract sync (#192), error messages (#193), origin alignment (#194), tests (#195)
- **BuildSpec assistant ST-A1-A10**: AssistProvider + BYOK (#205), secret scrubbing (#206), chat UI (#207), validate explanations (#208), catalog lookup (#209), generation + repair (#210), mock mode (#211), tests (#212), privacy notice (#213)
- **MSW E2E test harness** (#160, #104)
- **zod schema runtime validation** (#158, #103)
- **API_CONTRACT_VERSION 1.2.0 sync**
- **Contract conformance tests** (contractConformance.test.ts)
- **SpecDiff component**

### Changed
- **Split BuildsPage (#379)**: one 1,188-line file held the list, filters, detail, quality and pipeline. Following the `features/add-data` structure, it moves under `features/runs/` — panels in `components/` (KpiRow·RunListPanel·RunDetailPanel·SourcePipeline), logic in `buildContext.ts` (URL context normalisation)·`stageDetails.ts` (stage detail lookup)·`asyncState.ts` (per-surface async state). The page keeps **only 251 lines of screen assembly**. No behaviour change — the chunk size (30.56 kB) and the 1341 tests are unchanged
- **Split out NewBuildPage's spec assembly logic (#379)**: moves the form ↔ BuildSpec conversion, step field configuration and catalog lookup helpers to `features/build-spec/newBuildModel.ts`, and the starter templates to `templates.ts` + `components/TemplateButton.tsx`. The page goes from 1,032 lines → 786 lines. "What becomes the spec" can be checked without reading JSX. Splitting into per-step components is follow-up work
- **Finish the i18n UI string migration (#350)**: moves the last 4 user-visible strings (2 publish errors in `publish/api`; the draft-save failure and action rejection in `useAssistantSession`) to keys. The Korean left in `src/` is now only comments, mock/demo data, LLM prompts and example parameter values, and screen chrome has 0
- **i18n migration of 3 pages (#350)**: moves the hardcoded Korean UI strings in `WorkspacePage`·`DatasetDetailPage`·`BuildPublishPage` to keys (`workspace`/`datasetDetail`/`buildPublish`, 129 new keys each for ko/en — 1590 keys symmetric in total). The 3 module-constant label tables (`VALIDATION_META`·`STAGE_EXPLAINER`·`BUILD_STATUS_LABEL`) also become **key tables** instead of strings and are translated at render time — a defect where the language froze at import time
- **i18n migration of the App Shell and Report editor (#350)**: moves the hardcoded Korean in `Layout.tsx` (sidebar/header aria-label, theme, tagline, etc.) and `ReportEditorPage.tsx` to keys (`layout`/`reportEditor`, 37 new keys each for ko/en). The Shell spans every screen, so any string left here broke language switching on every screen
- **Route code splitting (#378)**: `router.tsx` statically imported all 23 pages, so opening a single first screen downloaded Monitoring, Reports and Assistant too (single chunk 1.23 MB / gzip 359 kB). Each page becomes `React.lazy` + dynamic import, with `Suspense` placed inside `withFeatureBoundary` so routes become chunk boundaries — a chunk load failure is also caught by that feature's fallback, so the shell does not go blank. Result: 49 chunks, entry chunk 424 kB / gzip 132 kB (63% reduction by gzip), Vite's 500 kB warning resolved
- **i18n migration of the 3 Add Data steps (#350)**: moves all hardcoded Korean UI strings in `ConfigureStep`·`PreviewValidationStep`·`ReviewBuildStep` to keys (`addData.configure`/`addData.preview`/`addData.review`, 89 new keys each for ko/en). Also fixes **2 module-constant i18n defects** found during the migration — `CREDENTIAL_PREREQUISITE_MESSAGE` and `PREVIEW_SOURCE_STATE_LABEL` were evaluated at module top level, freezing their text in the import-time language; they become `credentialPrerequisiteMessage()` / `previewSourceStateLabel()` respectively and resolve at render time
- **Add E2E (Playwright) to CI (#377)**: until now `npm run test:e2e` ran only when a person ran it by hand, so 38 specs (6 files) that could catch regressions were effectively idle. A dedicated `e2e` job installs only chromium (both projects are chromium), runs the specs on a mock-mode vite dev server, and keeps the trace as an artifact on failure. `@real-builder` specs, which need a real Builder, are already excluded by the grep in `playwright.config.ts`
- **Compress slow polling tests with fake timers (#376)**: `asyncBuildJob.test.ts` actually waited `POLL_INTERVAL_MS` (800ms) per case until terminal (16.9s), and in `assistantSession.test.tsx` the real-mode evidence lookup happened before the stub, so each request waited through builderApi's full exponential backoff (500ms+1000ms) (15.3s). The former skips only the wait with `vi.advanceTimersByTimeAsync` (`waitFor` does not recognise vitest fake timers, so it is replaced by a `settle()` helper); the latter lays down the stub first to make it deterministic — the two files 16.9s+15.3s → 0.11s+1.66s, full suite 112.5s → 79.4s
- **Coverage gate (#380)**: `coverage.thresholds` in `vitest.config.ts` pins the current level as a regression floor (statements 84 / branches 75 / functions 85 / lines 86 — 2 points below each of the measured 86.54/77.12/87.93/88.65). Only application code in `src/` is instrumented; entry points, type declarations and test files are excluded. `npm run test:coverage` and CI's dedicated `coverage` job own the gate — instrumentation is not added to the quality job, which runs twice on Node 20/22, so the cost is 1x
- **Clean up package metadata/toolchain warnings (#375)**: raises `version` in `package.json` from `0.1.0` → `0.4.0` to match this document's v0.4 section, and adds `"type": "module"` to remove Vite's `configLoader: 'native'` warning. `path.resolve(__dirname, …)` (a CJS global) in `vite.config.ts`/`vitest.config.ts` becomes `fileURLToPath(new URL("./src", import.meta.url))` so it works as plain ESM. Also removes the 2 standing eslint warnings (unused `test` import in `e2e/helpers.ts`, unused `t` in `HomePage.tsx`) — warnings must be 0 so that new warnings are not buried
- **Home workflow STEP labels follow language switching (#375)**: `WORKFLOW_STEPS` was evaluated with `i18n.t()` at module top level and fixed to the import-time language. Only the numbers stay constant; the labels resolve at render time
- Update the API_CONTRACT.md drift table — all operations aligned (#219)
- Move WORK_PLAN.md to .github/ (#222)

## v0.3

Build screens implemented, validation/preview.

- Build Detail screen (manifest summary, file list)
- Build Edit wizard (Stepper, React Hook Form)
- Build Run page
- Build Publish page
- Artifacts viewer
- Build list page
- Spec mapping layer (camelCase → snake_case)

## v0.2

Artifacts, preview.

- Artifact preview
- Dataset validation screen
- Validation result display
- Build output viewer

## v0.1

Initial structure.

- Vite + React SPA shell
- React Router main routes
- feature-based folder structure
- Builder API client (apiFetch, ApiError, retry)
- Vitest test environment
- Main page skeletons (Home, Builds, NewBuild)
- Domain type definitions
