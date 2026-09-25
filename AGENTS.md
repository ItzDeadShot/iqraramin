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
  publications, parsed at build time (Phase 2: citation-js, not yet added,
  ask before adding)
- `src/content/data/certifications.yaml`, `talks.yaml`, `news.yaml`,
  `now.yaml`: `file()` loader collections. Each entry needs a unique `id`
  field for the loader.

## Pages
Home, About, Research (publications), Projects (filterable), Blog,
Certifications, Now, Contact, 404. Only `index.astro` exists so far
(Phase 1 sanity check, not final design).

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
minimal site nav (Home, Research only, since those are the only pages that
exist so far).

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
   embedded in every generated JSON file's `license` field; still need to
   surface it visibly wherever Piece 1/2 data is shown on the site.
   **Still open**: once Piece 1's TS federated training exists, add a
   Vitest parity test confirming centralized TS training reaches accuracy
   within a few points of this Python model on the same data and seed.
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
3. Piece 1, federated poisoning sandbox (Home hero).
4. Piece 3, packet dissector bio (About).
5. Piece 4, MITRE ATT&CK coverage matrix (`/coverage`, standalone page).
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

Type-check content schemas and templates with `npm run astro check` (or
`npx astro check`). A bad frontmatter/data file should fail `astro build`,
not just look wrong at runtime; that's on purpose.
