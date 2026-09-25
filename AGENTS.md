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
Not chosen yet. No visual design has been committed to
(`src/styles/global.css` is placeholder-neutral). Concept: research lab
notebook / threat-intel report aesthetic, projects as "case files." Avoid
security clichés (no green-on-black terminal, no Matrix effects, no fake
shell prompts). One strong typographic pairing + one accent color, light
and dark mode, accessible.

## Security touches (not yet added)
- `/.well-known/security.txt`
- PGP key/fingerprint on Contact page
- CSP is already in place via a meta tag in `src/layouts/BaseLayout.astro`
  (note: `frame-ancestors` is ignored by CSP delivered via meta tag; that
  directive needs an HTTP header, which isn't available on static Pages
  hosting without a custom edge/proxy)

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
  were added in Phase 1 for `astro check`/editor tooling.
- Propose 2-3 concrete design directions before committing to visual
  design; phases after that: publications/projects pages, then
  blog/now/certifications, then command palette + research visualization +
  scheduled data fetching.

## Development
Use background mode for the dev server:

```sh
astro dev --background
```

Manage it with `astro dev stop`, `astro dev status`, `astro dev logs`.

Type-check content schemas and templates with `npm run astro check` (or
`npx astro check`). A bad frontmatter/data file should fail `astro build`,
not just look wrong at runtime; that's on purpose.
