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

## Common tasks

Run these **inside the container** (`just` with no args lists everything):

| Recipe        | What it does                                              |
| ------------- | --------------------------------------------------------- |
| `just dev`    | Astro dev server on http://localhost:4321                 |
| `just build`  | Production build                                          |
| `just check`  | `astro check` (diagnostics / types)                       |
| `just format` | Prettier write                                            |
| `just lint`   | ESLint                                                    |
| `just fix`    | Prettier + ESLint auto-fix                                |
| `just hooks`  | Install git pre-commit hooks                              |
| `just ci`     | The full gate: install, format, lint, check, build, hooks |

## CI

There is no external CI service. `just ci` **is** the gate, and it runs in the same
devcontainer used for development, so local and CI results are identical. From the host:

```sh
just ci-container   # boots the devcontainer, then runs `just ci` inside it
```

## Dependency updates

[`renovate.json`](renovate.json) configures Renovate to keep npm dependencies and the
Node base image up to date. Point your Renovate app/self-hosted runner at the repo.

## Package manager

pnpm, pinned via the `packageManager` field in `package.json` and provided by Corepack.
