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
Chosen: **Case File** (dossier / redacted-report aesthetic, see the
published design-direction artifact from the design-review conversation).
Not yet implemented in `src/styles/global.css` (still placeholder-neutral).
Fraunces (serif, 500-700) for headings, JetBrains Mono for metadata; cool
stone-grey paper background, stamp-red accent used only on status labels;
sharp corners, no rounded cards, status shown as a rotated bordered "stamp."
Light and dark mode, accessible. Avoid security clichés (no green-on-black
terminal, no Matrix effects, no fake shell prompts).

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
2. Piece 2, "Evade my detector" (Research) - next up.
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
