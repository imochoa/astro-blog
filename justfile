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

# Start the Astro dev server on http://localhost:4321
dev:
    pnpm run dev

# Production build
build:
    pnpm run build

# Preview the production build
preview:
    pnpm run preview

# Build the site, then validate its internal links and heading fragments
check-links: build
    pnpm run check:links

# Diagnostics / type check (astro check)
check:
    pnpm run check

# Format all files with Prettier
format:
    pnpm run format

# Verify formatting without writing changes
format-check:
    pnpm run format:check

# Lint with ESLint
lint:
    pnpm run lint

# Auto-fix lint issues
lint-fix:
    pnpm run lint:fix

# Format and auto-fix lint issues
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
# The Temporal worker deploys only after this recipe succeeds, leaving the prior
# published site intact.
ci: install-ci format-check lint check pre-commit check-links

# Bring the devcontainer up (podman via --docker-path)
up:
    devcontainer up --workspace-folder . --docker-path podman

# Canonical CI entrypoint from the host: boot the devcontainer, run `just ci` in it
ci-container: up
    devcontainer exec --workspace-folder . --docker-path podman just ci

# Remove build artifacts and installed dependencies
clean:
    rm -rf dist .astro node_modules
