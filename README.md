# iqraramin.com

Personal profile site for Muhammad Iqrar Amin (Q): cybersecurity research,
engineering projects, publications, and writing. Built with Astro, static
output, content-driven (Markdown/YAML/BibTeX), served by Cloudflare
Workers static assets at `https://iqraramin.com`.

## Project structure

```text
/
├── src/
│   ├── content.config.ts     # Zod schemas for every content collection
│   ├── content/
│   │   ├── projects/         # one Markdown file per project
│   │   ├── blog/             # blog posts (Markdown/MDX)
│   │   └── data/             # publications.bib, certifications/talks/news/now.yaml
│   ├── layouts/
│   │   └── BaseLayout.astro
│   ├── styles/
│   │   └── global.css        # placeholder, no design chosen yet
│   └── pages/
│       └── index.astro
└── .github/workflows/deploy.yml
```

## Local development

```sh
pnpm install         # pnpm is pinned via "packageManager" in package.json
pnpm dev             # http://localhost:4321
pnpm test            # unit tests (Vitest) for the interactive pieces' math
pnpm astro check     # type-check schemas and templates
pnpm build           # static output to ./dist/
pnpm preview         # serve the built ./dist/ locally
```

Content lives entirely in `src/content/`. Adding or editing a project,
blog post, certification, talk, or news item is a matter of editing a
Markdown or YAML file there and pushing; no component changes needed.
Every collection has a Zod schema in `src/content.config.ts`, so a
malformed entry fails `pnpm build` with a specific error instead of
silently breaking a page.

## Deploying (Cloudflare)

`wrangler.jsonc` deploys the built `dist/` folder as Cloudflare Workers
static assets (no Worker script) and attaches the `iqraramin.com` custom
domain. With the repo connected in the Cloudflare dashboard (Workers
Builds), every push to `main` builds and deploys:

- Build command: `pnpm run build` (also runs `scripts/verify-flags.mjs`)
- Deploy command: `npx wrangler deploy`

The Worker's name in the dashboard must match `name` in `wrangler.jsonc`.
Unknown paths serve `404.html` with a 404 status.

The canonical URL (canonical links, `security.txt`, `robots.txt`) comes
from `site` in `astro.config.mjs`.
