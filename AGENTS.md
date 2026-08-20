# AGENTS.md

## Project overview

This repository contains a statically built Astro 7 blog with MDX content collections. Sätteri processes Markdown, KaTeX renders math at build time, Pagefind provides client-side search, and Svelte is available for interactive islands. Development and CI run in the devcontainer so Node, pnpm, `just`, and `pre-commit` versions stay consistent.

- Astro source: `src/`
- File-based routes: `src/pages/`
- Site-wide components: `src/components/`
- Blog and post components: `src/components/blog/`
- Home-page sections: `src/components/home/`
- Reusable UI primitives: `src/components/ui/`
- Shared layouts: `src/layouts/`
- Shared data helpers: `src/lib/`
- Browser WebAssembly modules and declarations: `src/wasm/`
- MDX posts: `src/content/posts/`
- Tag definitions: `src/content/tags.json`
- Collection schemas and loaders: `src/content.config.ts`
- Global styles: `src/styles/`
- Unprocessed public assets: `public/`
- Astro configuration: `astro.config.mjs`
- Nginx-behind-Traefik deployment guidance: `docs/nginx-traefik.md`
- Sätteri/KaTeX bridge design and troubleshooting: `docs/markdown-math.md`
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

The dev server serves the latest Pagefind index from `dist/pagefind/`. Search results do not update on each content edit; run `just build` when the development index needs to be refreshed.

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
- Reuse `components/blog/PostList.astro` and `components/blog/PostCard.astro` for post summaries, `components/ui/FormattedDate.astro` for displayed dates, and `components/blog/PostNavigation.astro` for chronological article links instead of duplicating their markup.
- Keep post frontmatter compatible with the `posts` schema. Define every referenced tag in `src/content/tags.json`. Drafts are visible in development and excluded from production routes, RSS, sitemap, and search.
- Use `socialImage` for a post-specific public image; otherwise the shared 1200×630 image under `public/social/` is used.
- Keep site-wide foundations in `src/styles/global.css` and colocate component-specific styles in scoped Astro `<style>` blocks.
- Keep `data-pagefind-body` on post articles so search indexes published post content instead of site chrome. Mark embedded third-party widgets with `data-pagefind-ignore`. Never edit `dist/pagefind/` by hand.
- Preserve the light/dark theme through the semantic color variables in `src/styles/global.css`; do not add component colors that only work in one theme. Shiki is configured with paired light and dark themes.
- Keep TypeScript compatible with the strict Astro configuration in `tsconfig.json`.
- Prefer the configured aliases (`@/*` for `src/*`, `@/ui/*` for `src/components/ui/*`, and `@posts/*` for blog content and colocated assets) over long relative imports.
- Put files that need Astro/Vite processing under `src/`; put assets copied unchanged into the build under `public/`.
- Keep component frontmatter focused on data loading and setup, with rendered markup below it.
- Preserve accessible, semantic HTML and include useful alt text for content images.
- Use the configured Sätteri Markdown processor. GFM, frontmatter, math, heading attributes, directives, superscript, subscript, wikilinks, and smart punctuation are enabled. The project directive plugin renders directive nodes as semantic HTML.
- Write inline math as `$...$` and display math as `$$...$$`. `src/markdown/katex.mjs` renders both through Sätteri during the build, and `BasicLayout.astro` imports the local KaTeX stylesheet. Display math needs the two-stage MDAST/HAST workaround documented in `docs/markdown-math.md`; preserve its plugin order and built-in replacement node type. Do not add a client-side auto-render script or CDN stylesheet.
- WebAssembly used in browser examples belongs under `src/wasm/`. Keep a matching `{name}.d.wasm.ts` declaration and leave `allowArbitraryExtensions` enabled.
- Let Prettier control formatting; do not manually fight its output.
- Follow the existing ESLint configuration for JavaScript, TypeScript, and Astro files.

## Deployment

Production is static output served by Nginx behind Traefik. Traefik owns public HTTPS, redirects, certificates, and global TLS headers; Nginx listens only on the internal container network. Follow `docs/nginx-traefik.md` for clean routes, cache policy, the custom 404 page, CSP, and the WebAssembly MIME type. The CSP must continue to allow `https://hopp.sh` and `https://marimo.app` in `frame-src` while their embeds are published; keep `'self'` there for local notebook exports.

## Validation

For a focused change, run the relevant checks while iterating. Before handing off a change, run the complete gate inside the devcontainer:

```sh
just ci
```

There is no separate test suite or hosted CI workflow. `just ci` is the source of truth: it installs from the frozen lockfile, checks formatting and linting, runs Astro diagnostics and pre-commit hooks, produces a production build, and validates internal links and heading fragments in `dist/`.

Do not weaken checks or rewrite generated output to make the gate pass. Fix the source or configuration responsible for the failure.
