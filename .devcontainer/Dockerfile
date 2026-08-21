# Astro dev container.
#
# Deliberately NOT using devcontainer "features" — every tool is installed with
# normal container instructions so the image is portable and buildable with any
# OCI builder (docker or podman).
#
# Node 24 is the current LTS and even-numbered (Astro only supports even Node
# majors). Its bundled Corepack is recent enough to avoid the old pnpm
# signature-verification bug.
FROM node:24-bookworm

ENV DEBIAN_FRONTEND=noninteractive

# OS tooling: Python for pre-commit, Java and Graphviz for local PlantUML
# rendering, and curl for the just installer and pinned PlantUML JAR.
ARG PLANTUML_VERSION=1.2026.6
ARG PLANTUML_SHA256=89948f14c93756c7a3fb7b69078ff37e8489fd79dd430c582b931e2f65358690
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        default-jre-headless \
        git \
        graphviz \
        pipx \
        python3 \
    && mkdir -p /opt/plantuml \
    && curl --proto '=https' --tlsv1.2 -fsSL \
        "https://github.com/plantuml/plantuml/releases/download/v${PLANTUML_VERSION}/plantuml.jar" \
        -o /opt/plantuml/plantuml.jar \
    && echo "${PLANTUML_SHA256}  /opt/plantuml/plantuml.jar" | sha256sum -c - \
    && rm -rf /var/lib/apt/lists/*

ENV PLANTUML_JAR=/opt/plantuml/plantuml.jar

# just — task runner. Installed from the official release script, system-wide.
RUN curl --proto '=https' --tlsv1.2 -sSf https://just.systems/install.sh \
    | bash -s -- --to /usr/local/bin \
    && just --version

# pre-commit — installed globally via pipx so it is on PATH for every user.
ENV PIPX_HOME=/opt/pipx \
    PIPX_BIN_DIR=/usr/local/bin
RUN pipx install pre-commit \
    && pre-commit --version

# Enable Corepack. The concrete pnpm version is pinned by package.json's
# "packageManager" field and fetched on first use. Disable Corepack's prompt:
# Temporal runs this devcontainer non-interactively.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# Everything below runs as the unprivileged "node" user (uid 1000) that ships
# with the base image. Combined with podman's --userns=keep-id (see
# devcontainer.json) this makes bind-mounted files owned by the host user.
USER node

# Keep the pnpm store and global bin in the node user's home.
ENV PNPM_HOME=/home/node/.local/share/pnpm \
    PATH=/home/node/.local/share/pnpm:$PATH

WORKDIR /workspace
