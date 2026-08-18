# astro-blog

An [Astro](https://astro.build) site with a fully containerized dev environment.

## Getting started

Open the folder in an editor with Dev Containers support and **Reopen in Container**,
or bring it up from the terminal:

```sh
just up          # devcontainer up (podman)
```

The container is built from [`.devcontainer/Dockerfile`](.devcontainer/Dockerfile) —
no devcontainer _features_, everything is a normal container instruction. It ships
Node 24, pnpm (via Corepack), `just`, and `pre-commit`.

From a local VS Code window, run the **Dev Container: Create or start** task to
invoke `just up`. Once attached to the container, the other VS Code tasks wrap
the corresponding `just` recipes. The **Blog: Debug in Chrome** launch profile
starts the Astro development server through `just dev` before opening the site.

## Common tasks

Run these **inside the container** (`just` with no args lists everything):

| Recipe             | What it does                                               |
| ------------------ | ---------------------------------------------------------- |
| `just dev`         | Start Astro in the background on http://localhost:4321     |
| `just build`       | Production build                                           |
| `just check`       | `astro check` (diagnostics / types)                        |
| `just check-links` | Build and validate internal links and heading fragments    |
| `just format`      | Prettier write                                             |
| `just lint`        | ESLint                                                     |
| `just fix`         | Prettier + ESLint auto-fix                                 |
| `just hooks`       | Configure the versioned devcontainer-aware Git hook        |
| `just ci`          | Full validation, production build, and internal link check |

## Writing posts

Add posts as MDX files under `src/content/posts/`. The filename becomes the
post ID and URL. Frontmatter follows this shape:

```mdx
---
title: My post
description: A short summary.
publishedAt: 2026-08-18
updatedAt: 2026-08-20 # optional
socialImage: /social/my-post.png # optional; place the file under public/
tags:
  - astro
draft: false
---
```

Define tags once in `src/content/tags.json`. Post tag references are checked
against that file during `astro check`. Post-specific assets can live under
`src/content/posts/assets/` and be imported from MDX with the `@posts/*` alias.
The blog index uses Astro's built-in pagination, with the page size configured
in `src/lib/posts.ts`.

## Discovery and metadata

Production builds generate `/sitemap-index.xml`, `/robots.txt`, and `/rss.xml`.
The shared layout provides canonical URLs, Open Graph and Twitter metadata, RSS
and sitemap discovery links, and `BlogPosting` structured data for posts.

## Search

Pagefind builds the search index into `dist/pagefind/` after every production
build. In development, `astro-pagefind` serves the most recently built index
from `dist/` through the Astro dev server. Run `pnpm run build` after changing
published content when you need to refresh development search results.

## CI

There is no external CI service. `just ci` **is** the gate, and it runs in the same
devcontainer used for development, so local and CI results are identical. From the host:

```sh
just ci-container   # boots the devcontainer, then runs `just ci` inside it
```

`just hooks` configures Git to use the versioned `.githooks/pre-commit`
wrapper. A host-side `git commit` starts or reuses the devcontainer and runs
checks there; inside the devcontainer, it runs `pre-commit` directly. The full
CI gate builds the static site and then uses Linkinator to check internal URLs,
assets, and server-rendered heading fragments.

## Nginx deployment

Build the site, copy `dist/` to the web root, and follow
[`docs/nginx-traefik.md`](docs/nginx-traefik.md). The guide keeps TLS and public
routing in Traefik while Nginx serves the static files over its internal container
network. It covers clean Astro routes, the custom 404 page, caching, compression,
security headers, the Hoppscotch iframe CSP allowlist, and the WebAssembly MIME
type.

## Dependency updates

[`renovate.json`](renovate.json) configures Renovate to keep npm dependencies and the
Node base image up to date. Point your Renovate app/self-hosted runner at the repo.

## Package manager

pnpm, pinned via the `packageManager` field in `package.json` and provided by Corepack.
