# AGENTS.md

## Project overview

This repository contains a statically built blog using Astro. Development and CI are expected to run in the devcontainer so that Node, pnpm, `just`, and `pre-commit` versions stay consistent.

- Astro source: `src/`
- File-based routes: `src/pages/`
- Shared components: `src/components/`
- Shared layouts: `src/layouts/`
- Shared data helpers: `src/lib/`
- MDX posts: `src/content/posts/`
- Tag definitions: `src/content/tags.json`
- Collection schemas and loaders: `src/content.config.ts`
- Global styles: `src/styles/`
- Unprocessed public assets: `public/`
- Astro configuration: `astro.config.mjs`
- Generated output: `dist/` and `.astro/`
- Generated search index: `dist/pagefind/`

Do not edit or commit generated files in `dist/`, `.astro/`, `node_modules/`, or `.pnpm-store/`.

## Development environment

Use the devcontainer for project commands. From the host, start it with:

```sh
just up
```

Then run commands inside the container. The dev server is available at <http://localhost:4321>:

```sh
just dev
```

The container uses Node 24 and the pnpm version pinned in `package.json`. Use pnpm rather than npm or Yarn. When dependencies change, commit both `package.json` and `pnpm-lock.yaml`. Keep `pnpm-workspace.yaml` build-script allowances explicit.

## Common commands

Run `just` to list all recipes. The main recipes are:

```sh
just install       # install dependencies
just dev           # start Astro's development server in the background
just build         # create the production build
just check         # run Astro diagnostics and type checking
just check-links   # build and validate internal links and fragments
just format-check  # check Prettier formatting
just lint          # run ESLint
just fix           # apply Prettier and ESLint fixes
just pre-commit    # run every pre-commit hook
just ci            # run the complete validation gate
```

If operating from the host rather than an interactive container, use `just ci-container` for the canonical full check.

## Coding conventions

- Follow Astro's file-based routing and component conventions.
- Keep most components server-rendered. Use Svelte and a `client:*` directive only for interactive islands; prefer `client:visible` for expensive scenes below the fold.
- Dispose browser resources, observers, and animation frames when interactive components are destroyed.
- Use collection entry IDs for blog and tag route parameters; add a separate slug only when the public URL must differ from the entry ID.
- Use Astro's `paginate()` API for blog archive pagination. Keep page one at `/blog/` and later pages under `/blog/page/<number>/`.
- Keep post frontmatter compatible with the `posts` schema. Define every referenced tag in `src/content/tags.json`.
- Keep site-wide foundations in `src/styles/global.css` and colocate component-specific styles in scoped Astro `<style>` blocks.
- Keep `data-pagefind-body` on post articles so search indexes published post content instead of site chrome. Never edit `dist/pagefind/` by hand.
- Keep TypeScript compatible with the strict Astro configuration in `tsconfig.json`.
- Prefer the configured aliases (`@/*` for `src/*`, `@/ui/*` for `src/components/ui/*`, and `@posts/*` for blog content and colocated assets) over long relative imports.
- Put files that need Astro/Vite processing under `src/`; put assets copied unchanged into the build under `public/`.
- Keep component frontmatter focused on data loading and setup, with rendered markup below it.
- Preserve accessible, semantic HTML and include useful alt text for content images.
- Use the configured Sätteri Markdown processor. GFM, frontmatter, math, heading attributes, directives, superscript, subscript, wikilinks, and smart punctuation are enabled. The project directive plugin renders directive nodes as semantic HTML.
- Let Prettier control formatting; do not manually fight its output.
- Follow the existing ESLint configuration for JavaScript, TypeScript, and Astro files.

## Validation

For a focused change, run the relevant checks while iterating. Before handing off a change, run the complete gate inside the devcontainer:

```sh
just ci
```

There is no separate test suite or hosted CI workflow. `just ci` is the source of truth: it installs from the frozen lockfile, checks formatting and linting, runs Astro diagnostics and pre-commit hooks, produces a production build, and validates internal links and heading fragments in `dist/`.

Do not weaken checks or rewrite generated output to make the gate pass. Fix the source or configuration responsible for the failure.
