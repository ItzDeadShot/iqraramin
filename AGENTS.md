# Personal profile website (Astro + GitHub Pages)

## About
Muhammad Iqrar Amin (goes by Q): cybersecurity researcher, engineer, and
software developer. Research covers federated learning, intrusion detection
systems, deep learning ensembles, and explainable AI. This site is a
long-term professional profile: publications, engineering projects,
certifications, and blog posts.

## Goal
Mostly static, hosted on GitHub Pages at `itzdeadshot.github.io` (custom
domain later). All content comes from data files (YAML/Markdown/BibTeX) so
the site updates without touching components.

## Stack and architecture
- Astro, static output (`output: 'static'` in `astro.config.mjs`), minimal
  client-side JS (islands only where needed)
- TypeScript
- Astro content collections with Zod schemas (`src/content.config.ts`) for
  every content type, so bad data fails the build
- Deployment via GitHub Actions using `withastro/action`, deploying to
  GitHub Pages (`.github/workflows/deploy.yml`)
- No third-party trackers, no external font or script CDNs (self-host fonts)
- Import `z` from `astro/zod`, not `astro:content` (deprecated in Astro 7,
  removed in Astro 8). Use `z.url()` / `z.email()` etc., not the deprecated
  `.url()` / `.email()` chained methods.

## Content layer
- `src/content/projects/`: one file per project (title, type
  [research|engineering|tool], status, year, tags, links
  {repo,paper,demo}, featured, summary, optional body)
- `src/content/blog/`: Markdown posts (title, date, tags, draft, summary)
- `src/content/data/publications.bib`: single source of truth for
  publications. Loaded into the `publications` collection by a custom
  loader using the site's own small, strict BibTeX reader
  (`src/lib/bibtex.ts`: braced/quoted/numeric fields, nested braces, errors
  with line numbers; rejects @string macros and `#` concatenation). The
  .bib is imported as `?raw` text through Vite (no Node fs / @types/node).
  Citation *formatting* for a publications page is still open (citation-js
  was the earlier idea; ask before adding).
- ATT&CK links: projects (frontmatter `attack: [{ id: T1046, relation:
  detects }]`) and publications (BibTeX `attack = {T1046:detects, ...}`)
  share one Zod rule in `content.config.ts` that checks each ID against the
  pinned ATT&CK release; relation is detects | mitigates | studies. The
  current mappings are placeholders marked `TODO(Q):`.
- `src/content/data/certifications.yaml`, `talks.yaml`, `news.yaml`,
  `now.yaml`: `file()` loader collections. Each entry needs a unique `id`
  field for the loader.

## Pages
Home, About, Research (publications), Projects (filterable), Blog,
Certifications, Now, Contact, 404. Built so far: Home (Piece 1 hero),
About (bio + Piece 3), Research (Piece 2; the publications list itself is
not built yet), Coverage (Piece 4).

## Design direction
Chosen and implemented: **Case File** (dossier / redacted-report
aesthetic). Tokens live in `src/styles/global.css`: Fraunces (self-hosted
variable font, `public/fonts/fraunces-variable.woff2`, `font-optical-sizing:
auto` so one file covers body text and display headings) for both body and
headings, JetBrains Mono (self-hosted, `public/fonts/jetbrains-mono-variable.woff2`)
for metadata; cool stone-grey paper background, stamp-red accent reserved
for flagged/malicious state and status labels; sharp corners (no rounded
cards), status shown as a rotated bordered "stamp." Light/dark via
`prefers-color-scheme` plus a `[data-theme]` override hook for a future
toggle (not built yet). Both self-hosted fonts are OFL-licensed, see
`public/fonts/LICENSE.md`. Contrast-checked: every text/background pairing
in both themes clears WCAG AA (4.79:1 to 15.5:1). `BaseLayout.astro` has a
minimal site nav listing only pages that exist (Home, About, Research,
Coverage).

## Security touches (not yet added)
- `/.well-known/security.txt`
- PGP key/fingerprint on Contact page
- CSP is already in place via a meta tag in `src/layouts/BaseLayout.astro`
  (note: `frame-ancestors` is ignored by CSP delivered via meta tag; that
  directive needs an HTTP header, which isn't available on static Pages
  hosting without a custom edge/proxy)

## Interactive pieces (real, working miniatures, not decorative loops)

Six pieces, each a working miniature of real security research the visitor
can act on, not a scripted animation. Global rules for all of them: real
computation with honest "toy model" labels where applicable, Astro islands
hydrated `client:visible`, vanilla TypeScript, heavy work in a Web Worker,
seeded PRNG for reproducibility, meaningful static first paint (no-JS and
pre-hydration), `prefers-reduced-motion` swaps autoplay for step controls,
keyboard operable with visible focus and ARIA, WCAG AA contrast in both
themes, deliberate mobile layouts, ~50KB gzipped JS budget per island,
Lighthouse 90+, content from `src/content/data/`, no em-dashes, no runtime
network requests, unit tests (Vitest) for all math.

Build order and status:
1. **Shared dataset pipeline** - done, revised after first review.
   `scripts/prepare_ids_dataset.py` (Python, pandas+numpy, offline only)
   downloads NSL-KDD (mirror URL + SHA-256 pinned in `MIRROR_FILES`, fails
   loudly on a hash mismatch), derives 12 interpretable features (duration
   and both byte counts are log1p-transformed before standardizing, see
   `transform` in feature-schema.json; nothing is globally locked anymore).
   Builds a 2,000-row balanced+category-stratified training pool, a
   genuinely held-out 600-row test set from KDDTest+ (300 benign / 300
   malicious, scaler fit on the training pool only; KDDTest+ deliberately
   includes attack variants absent from training, so a linear model
   plateaus around 78-82% there by design, not by bug, currently 80.2%).
   8 client partitions: IID, and non-IID-by-attack-category where every
   client keeps the same 125 benign rows as the IID split plus a capped 50
   malicious rows from its dominant category (71.4% benign on every
   client, uniformly). A hand-written (gradient descent, no sklearn)
   logistic regression's weights, and 4 preselected sample flows for
   Piece 2 spanning a difficulty range (0.76-0.998 confidence, one
   guaranteed >=0.9 anchor, confirmed distinct rows, no duplicated u2r
   sampling). Locks for Piece 2's sliders are now per-sample and
   attack-aware (`featureNotes` in samples.json): structural locks
   (`logged_in`, `is_priv_port`) always apply; category-specific locks add
   more (e.g. dos also locks `serror_rate`/`flag_is_error`, since a SYN
   flood's own error rate is what defines it); every unlocked feature
   carries a short "cost to the attacker" note.
   Outputs committed under `src/content/data/ids/` (raw NSL-KDD files are
   not committed, only the generated JSON, all under ~150KB each). Re-run
   with `python3 scripts/prepare_ids_dataset.py` (needs `pip install -r
   scripts/requirements.txt`); it's deterministic (seed 42).
   **License**: NSL-KDD, cite Tavallaee/Bagheri/Lu/Ghorbani, CISDA 2009;
   official host (unb.ca/cic/datasets/nsl.html) is currently down but its
   stated terms permit redistribution/mirroring with that citation, which
   is what the script's pinned mirror relies on. The citation string is
   embedded in every generated JSON file's `license` field and shown under
   both pieces via `src/components/DatasetCitation.astro`.
   TS/Python parity test lives in `src/lib/fl/sim.test.ts`
   (`trainCentralized` mirrors the Python trainer; currently an exact
   80.17% match).
2. **Piece 2, "Evade my detector"** - done, on `/research`
   (`src/components/EvadeDetector.astro`, math in `src/lib/ids/detector.ts`,
   client wiring in `src/lib/ids/evade-detector-client.ts`, copy in
   `src/content/data/pieces.yaml`). Real logistic-regression math runs
   client-side on every slider input: live probability, per-feature
   attribution bars (`w_i * (z_i - baseline_z_i)`, sums exactly to the
   logit difference, tested), and an analytically-computed minimal
   counterfactual shown at all times (not just after success), comparing
   the visitor's actual path to the true minimum.
   **Important bug found and fixed during testing**: the first version of
   the counterfactual math solved an *unconstrained* minimum-norm problem,
   which for all 4 samples wanted at least one feature to move outside its
   slider's plausible [min, max] range (e.g. `dst_host_count` above its
   max). Naively clamping that solution left every sample looking
   un-evadable even when dragging every unlocked slider to its extreme
   (verified in a real headless-browser run: neptune only moved from
   99.8% to 98.5%). Fixed with a small bound-constrained active-set
   algorithm (`computeMinimalCounterfactual` in `detector.ts`): solve the
   closed form over free features, clamp any that violate their bound and
   move them to a fixed set, re-solve, repeat (at most 12 passes). With
   that fix, all 4 real samples are genuinely evadable within plausible
   bounds, confirmed with a real Playwright run (99.8% down to 0.6% by
   choosing the correct direction per slider). `feasible`/
   `achievedProbability` fields let the UI honestly report the rare case
   where even saturating every unlocked feature doesn't reach the
   threshold, instead of silently doing nothing.
   **Deviations from the global rules, worth confirming**: no Web Worker
   (the "heavy work" rule is about training rounds; a 12-weight dot
   product plus a sigmoid on every slider input is microseconds of work,
   not worth the complexity) and no seeded PRNG (nothing at runtime is
   random; "New sample" round-robins deterministically through the 4
   preselected flows). `client:visible` itself is a framework-component
   directive and doesn't apply to a plain `.astro` component with a
   vanilla `<script>`, so the same lazy-hydration behavior is done by hand
   with an `IntersectionObserver` in the component's script.
   Verified: 17 Vitest cases (including against the real production
   model/samples, not just synthetic fixtures) all pass; `astro check`
   clean; JS bundle 15.9KB raw / 5.0KB gzipped (well under the 50KB
   budget) including the bundled feature-schema/scaler/model/samples JSON;
   real headless-Chromium runs confirm locked sliders truly can't move,
   keyboard operation works, static (pre-hydration) HTML already shows the
   correct neptune sample/probability/bars/locks, light and dark mode both
   render correctly, mobile layout stacks without horizontal scroll, no
   console errors. Have not run Lighthouse itself.
   Still has a `TODO(Q):` placeholder for the explainer body text, per the
   copy rules.
3. **Piece 1, federated poisoning sandbox** - done, Home hero
   (`src/components/FederatedSandbox.astro`; math in `src/lib/fl/`:
   `sim.ts` local SGD/attacks/rounds, `aggregators.ts`, `pca.ts`,
   `prng.ts`; `worker.ts` runs rounds in a Web Worker; `render.ts` builds
   the SVG markup for both the build-time snapshot and the live client;
   `sandbox-client.ts` is the DOM controller). Home hero copy comes from a
   new `site` collection (`src/content/data/site.yaml`); the Phase 1
   featured-projects sanity list on the home page is gone.
   Tuned settings (`DEFAULT_TRAINING`): 1 local epoch, lr 0.05, batch 25,
   L2 1e-3, seeded Gaussian init (std 1). Honest FedAvg goes from 43%
   (round 0) to ~80% by round 6-10, peaking ~87% then drifting toward
   ~84%: early federated SGD generalizes to KDDTest+ better than the fully
   converged offline model (80%). One boosted client (x10) drags FedAvg to
   ~61% with ~77% of attacks missed by round 20; switching to Multi-Krum
   or median recovers to ~79-80% within ~10 rounds. These are unit tests
   (`sim.test.ts`), not just observations.
   **Deviations, confirmed with measurements**: 'boost' is a boosted
   *label flip* (explicit boosting, Bhagoji et al. 2019), because scaling
   an honest update is harmless (FedAvg stayed at 80%); sign flip also
   uses the scale factor (-k x update) since -1x from 1 of 8 clients
   barely registers. "Krum" is Multi-Krum (averages the n-f best), labeled
   as such, because classic Krum keeps 1 update and marks 7 honest ones
   rejected. Median never marks a client rejected (with 8 clients, 6 are
   off-median in every coordinate by construction); trimmed mean marks a
   client rejected when trimmed in >50% of coordinates. Label flipping is
   targeted (malicious relabeled benign); the chart's "attacks missed" line
   is that targeted-class miss rate, shown always. All clients share the
   pool-fitted scaler (a simplification). Robust rules sometimes reject
   honest clients too (e.g. Multi-Krum drops C7 with no attacker); the
   status line says so.
   Verified: 46 Vitest cases pass (aggregators, PCA, PRNG, local training,
   poisoning, acceptance criteria, parity); real headless-Chromium runs of
   autoplay -> attack -> switch aggregator, reduced motion (no autoplay,
   no packet animation, Step works), keyboard (client toggles, chart and
   scatter tooltips via arrow keys), no-JS snapshot, no runtime network
   requests (data is bundled into the worker), no console errors, no
   horizontal overflow at 390px. Bundles: main-thread island 6.6KB gzip,
   worker 36.4KB gzip including all training/test data. Lighthouse:
   100/100/100/100 on both / and /research, CLS 0 (fixed along the way:
   a `.fl-grid` class collision that stroked all SVG text, sub-12px labels
   including the dataset citation, a hydration/per-round layout shift from
   the status line, and font-swap shift via font preloads; a global
   `[hidden] { display: none !important }` rule now backs the hidden
   attribute). Explainer body is still `TODO(Q):`.
4. **Piece 3, packet dissector** - done, on `/about`
   (`src/components/PacketDissector.astro`, bytes in `src/lib/packet/packet.ts`,
   interaction in `src/lib/packet/dissector-client.ts`). Bio paragraphs and
   every header value (MACs, IPs, ports, TTL, IP ID, seq/ack, TCP flags,
   window) come from `src/content/data/about.yaml`, schema-validated in the
   `about` collection. `buildPacket` assembles Ethernet II / IPv4 / TCP with
   RFC 1071 checksums (IP header, TCP with pseudo-header); `dissect` parses
   bytes back into the tree independently, so every tree value and every
   "[correct]" comes from the bytes, and the build throws if the frame
   ever fails verification. Also cross-checked once with an independent
   Python parser against the built page's bytes. No FCS (as in captures).
   Values use RFC 5737 documentation IPs and locally administered MACs.
   UI: collapsible `<details>` tree (works without JS), hex + ASCII panes
   (`aria-hidden`; each tree button carries its byte offsets and hex in
   visually hidden text instead), hover/focus previews, click pins (Escape
   clears), a byte hover lights its narrowest field(s), a payload byte
   lights its whole word in hex, ASCII and the bio paragraph itself via
   the CSS Custom Highlight API (no DOM changes to the bio text). 16 bytes
   per row, 8 at <=640px. The bio's first paragraph is an explicit
   `TODO(Q):` draft notice (the bio is copy for Q to write); the explainer
   body is `TODO(Q):` too.
   Verified: 15 packet tests (RFC 1071 and a known IPv4 header checksum,
   round trip, corruption detection per field, UTF-8, MTU limit, bad
   addresses); headless-Chromium runs of hover/focus/pin/collapse, mobile
   8-byte rows, no-JS render; Lighthouse 100/100/100/100 on `/about`
   (DOM-size diagnostic flags ~1,600 elements from the per-byte cells; TBT
   stays 0ms). JS 1.7KB gzip.
   **Site-wide fix found here**: Astro inlines scripts under Vite's 4KB
   `assetsInlineLimit`, which the CSP (`script-src 'self'`) then blocks;
   Pieces 1/2 only worked because their scripts were bigger.
   `astro.config.mjs` now sets `vite.build.assetsInlineLimit: 0`; keep it,
   and check new pages ship no inline `<script>`.
5. **Piece 4, ATT&CK coverage matrix** - done, on `/coverage`
   (`src/components/AttackMatrix.astro`, logic in `src/lib/attack/matrix.ts`,
   filters/detail in `src/lib/attack/matrix-client.ts`).
   `scripts/prepare_attack_data.py` (stdlib only) reduces the pinned
   Enterprise ATT&CK v19.2 STIX bundle (URL + SHA-256 pinned, fails on
   mismatch; revoked/deprecated objects dropped) to
   `src/content/data/attack/enterprise.json` (30KB: 15 tactics in matrix
   order, 222 techniques, 475 sub-techniques). v19 splits Defense Evasion
   into Stealth and Defense Impairment; nothing hardcodes tactics.
   Matrix is built at build time; sub-technique claims roll up to the
   parent cell (the detail panel says "via T1110.001 ..."); techniques
   appear under every tactic they belong to. Intensity = distinct works
   (1 / 2 / 3+) as ink tinted 10/20/32% into the surface, with full-ink
   text only (muted text fails AA on the darker fills) plus the count
   printed in the cell; relation = D/M/S letter badges with solid / double
   / dashed borders (never color alone). Default view shows covered
   techniques only; "Show the full matrix" is a visually hidden checkbox
   driving CSS `:has()`, so it works without JS (full view scrolls
   sideways). Filters by relation and work type (projects' research /
   engineering / tool, plus publication) re-count cells, the summary, the
   detail panel and the table. Detail panel lists each work with type,
   year, relation and its links (projects have no pages yet, so it links
   Paper/Code/Demo, or DOI for papers, else "No public link yet"). A table
   view mirrors everything. Client data ships as a non-executed
   `application/json` block. MITRE's required attribution plus a
   trademark / no-endorsement line sit in the footer.
   Verified: a typo (T9999) or revoked ID (T1086) in a project, and a
   malformed BibTeX `attack` item, each fail the build with a message
   naming the entry and ID; adding a tag moved a cell from level 0 to 1
   with no component change. 18 new tests (BibTeX reader incl. the real
   file, matrix roll-up, counts, filters, the pinned release). Browser runs
   of filters, detail, keyboard, Escape, full view with JS and without,
   light/dark, mobile (no overflow). Lighthouse 100/100/100/100 (DOM-size
   diagnostic only, 254 pre-rendered cells). JS 1.8KB gzip.
   Deviation: the secure-aggregation toolkit has no mapping on purpose;
   ML-poisoning defenses belong to MITRE ATLAS, not Enterprise ATT&CK.
   Explainer body is `TODO(Q):`.
6. Piece 5, hidden flags (sitewide + `/flags`).
7. Piece 6, "You are the traffic" (`/whoami`).

Wait for review after each piece before starting the next.

## Automation (later phase)
Scheduled weekly rebuild fetching citation counts (Semantic Scholar/ORCID)
and repo stars (GitHub API) at build time; must degrade gracefully if an
API is down. "Last updated" dates from git history.

## Writing style for site copy
- No em-dashes anywhere.
- Refer to publication venues as "high-impact, top-quartile" rather than
  naming them in placeholder copy.

## Working agreements
- Keep commits small and meaningful.
- Ask before adding any new dependency beyond the core stack (Astro,
  TypeScript, Zod via astro/zod). `@astrojs/check` + `typescript` devDeps
  were added in Phase 1 for `astro check`/editor tooling. `vitest` was
  added for unit-testing the interactive pieces' math (approved). No ML or
  charting library for the interactive pieces without asking first, the
  math is meant to be hand-written.
- Design direction is decided (Case File, see above); still need to
  actually build it into `src/styles/global.css` and the layouts/pages.

## Development
Use background mode for the dev server:

```sh
astro dev --background
```

Manage it with `astro dev stop`, `astro dev status`, `astro dev logs`.

Package manager is **pnpm** (pinned via `packageManager` in `package.json`;
the deploy action reads it). `pnpm-workspace.yaml` blocks dependency install
scripts except esbuild's and refuses package versions under a day old
(`minimumReleaseAge: 1440`); adding a brand-new release means an exact-version
entry in `minimumReleaseAgeExclude`. Don't add a `package-lock.json`.

Run tests with `pnpm test`. Type-check content schemas and templates with
`pnpm astro check`. A bad frontmatter/data file should fail `astro build`,
not just look wrong at runtime; that's on purpose.
