# astro-blog task runner. Run `just` with no arguments to list recipes.
# These recipes are meant to run inside the devcontainer, where pnpm, just and
# pre-commit are all provided. The "ci" recipe is the same gate used locally.

# List available recipes
default:
    @just --list

# Install dependencies
install:
    pnpm install

# Update
update:
    pnpx @astrojs/upgrade

# Install dependencies for CI (fails if the lockfile is stale)
install-ci:
    pnpm install --frozen-lockfile

[group("package.json")]
list-npm:
    npm run

# Get list with...
# jq ".scripts | keys" < package.json
[arg("cmd", pattern="start|build|check|check:links|dev|format|format:check|generate:assets|lint|lint:fix|prebuild|preview", help="What pnpm package.json command to run")]
pnpm cmd:
    pnpm run {{ cmd }}

# Start the Astro dev server on http://localhost:4321
[group("package.json")]
dev: (pnpm "dev")

[group("package.json")]
prebuild: (pnpm "prebuild")

# Production build
[group("package.json")]
build: (pnpm "build")

# Preview the production build
[group("package.json")]
preview: (pnpm "preview")

# Build the site, then validate its internal links and heading fragments
[group("package.json")]
check-links: build && (pnpm "check:links")

# Diagnostics / type check (astro check)
[group("package.json")]
check: (pnpm "check")

# Format all files with Prettier
[group("package.json")]
format: (pnpm "format")

# Verify formatting without writing changes
[group("package.json")]
format-check: (pnpm "format:check")

# Lint with ESLint
[group("package.json")]
lint: (pnpm "lint")

# Auto-fix lint issues
[group("package.json")]
lint-fix: (pnpm "lint:fix")

# Format and auto-fix lint issues
[group("package.json")]
fix: format lint-fix

# Use the versioned hook wrapper. On the host it enters the devcontainer;
# inside the devcontainer it runs pre-commit directly.
hooks:
    git config core.hooksPath .githooks
    pre-commit install-hooks

# Run every pre-commit hook against all files
pre-commit:
    pre-commit run --all-files

# Full CI gate: validate sources, build dist/, then check its internal links.
ci: install-ci format-check lint check pre-commit check-links

# Build deployable output without running the CI checks. Temporal runs this
# independently from `ci-container`, so a check failure does not block publishing.
publish: install-ci build

# Bring the devcontainer up (podman via --docker-path)
[group("host")]
up:
    devcontainer up --workspace-folder . --docker-path podman

# Canonical CI entrypoint from the host: boot the devcontainer, run `just ci` in it
[group("host")]
ci-container: up
    devcontainer exec --workspace-folder . --docker-path podman just ci

# Temporal publication entrypoint: build dist/ without running the CI gate
[group("host")]
publish-container: up
    devcontainer exec --workspace-folder . --docker-path podman just publish

# Remove build artifacts and installed dependencies
[group("host")]
clean:
    rm -rf dist .astro node_modules .pnpm-store
