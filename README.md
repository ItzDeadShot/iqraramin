# itzdeadshot.github.io

Personal profile site for Muhammad Iqrar Amin (Q): cybersecurity research,
engineering projects, publications, and writing. Built with Astro, static
output, content-driven (Markdown/YAML/BibTeX), deployed to GitHub Pages.

Status: Phase 1 (scaffold). No visual design has been chosen yet.

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

## Deploying (GitHub Pages)

Deployment is automated: `.github/workflows/deploy.yml` builds with
`withastro/action` and deploys via `actions/deploy-pages` on every push to
`main`.

One-time setup in the GitHub repo settings (only needs doing once):

1. Go to **Settings → Pages**.
2. Under **Build and deployment → Source**, select **GitHub Actions**
   (not "Deploy from a branch").
3. Push to `main`. The **Deploy to GitHub Pages** workflow will run and
   publish the site at `https://itzdeadshot.github.io`.

No secrets or tokens need to be configured manually; the workflow uses the
repo's built-in `GITHUB_TOKEN` via the `pages: write` / `id-token: write`
permissions already declared in the workflow file.
