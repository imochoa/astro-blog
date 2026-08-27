# Motion Canvas and Canvas Commons experiment

This repository briefly carried browser-rendered examples for both [Motion Canvas](https://motioncanvas.io/) 3.17.2 and [Canvas Commons](https://canvascommons.io/) 0.3.1. The experiment was removed because integrating either project into the Astro build required too much supporting configuration. This document records the working setup in case it is worth revisiting later.

## Why the animation builds were separate

Both libraries provide a Vite plugin which handles `?scene` imports and supplies its own Rollup project inputs. Astro also controls Vite's inputs, so adding either plugin to `astro.config.mjs` caused the two build pipelines to compete. The working arrangement treated each animation project as a separate Vite build:

```text
animations/
├── canvas-commons/
│   ├── src/project.ts
│   ├── src/scenes/intro.tsx
│   ├── tsconfig.json
│   └── vite.config.ts
└── motion-canvas/
    ├── package.json
    ├── src/project.ts
    ├── src/scenes/intro.tsx
    ├── tsconfig.json
    └── vite.config.ts
```

Each `project.ts` imported a scene through the plugin query and passed it to `makeProject`:

```ts
import { makeProject } from "@motion-canvas/core";
import intro from "./scenes/intro?scene";

export default makeProject({ scenes: [intro] });
```

The Canvas Commons version used the equivalent imports from `@canvas-commons/core`. Both projects also needed a declaration file referencing the library's `core/project` types and the `.meta` files generated for the project and scene.

## Canvas Commons build

Canvas Commons worked with the root project's Vite 8 installation. Its runtime and build packages were installed at the repository root:

- `@canvas-commons/player`
- `@canvas-commons/2d`
- `@canvas-commons/core`
- `@canvas-commons/editor`
- `@canvas-commons/vite-plugin`
- `vite`

The standalone config was:

```ts
import canvasCommons from "@canvas-commons/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [canvasCommons({ project: "./src/project.ts" })],
  build: {
    emptyOutDir: true,
    outDir: "../../public/animations/canvas-commons",
    rollupOptions: {
      output: {
        entryFileNames: "intro.js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
```

It had to run from `animations/canvas-commons/` so the relative project path resolved correctly:

```json
{
  "build:canvas-commons": "tsc --noEmit -p animations/canvas-commons/tsconfig.json && cd animations/canvas-commons && vite build --base /animations/canvas-commons/"
}
```

The matching `--base` was necessary because the entry module imported shared chunks. Without it, the browser requested those chunks from the wrong URL.

## Motion Canvas build

Motion Canvas 3.17 supports Vite 4 and 5, while the blog used Vite 8. It therefore lived in a pnpm workspace package with its own toolchain:

```yaml
packages:
  - animations/motion-canvas
```

```json
{
  "name": "astro-blog-motion-canvas-animation",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc --noEmit && vite build --base /animations/motion-canvas/"
  },
  "dependencies": {
    "@motion-canvas/2d": "^3.17.2",
    "@motion-canvas/core": "^3.17.2"
  },
  "devDependencies": {
    "@motion-canvas/ui": "^3.17.2",
    "@motion-canvas/vite-plugin": "^3.17.2",
    "typescript": "~5.9.3",
    "vite": "^5.4.21"
  }
}
```

`@motion-canvas/player` remained a root runtime dependency because Astro imported the web component. pnpm kept Vite 5 and TypeScript 5 inside the animation package without downgrading Astro's Vite 8 and TypeScript 6 setup.

There was one more Node 24 compatibility workaround. Motion Canvas 3 publishes its Vite plugin as CommonJS, and a normal default import was wrapped twice. The config used `createRequire` to obtain the plugin function:

```ts
import { createRequire } from "node:module";
import { defineConfig } from "vite";

const { default: motionCanvas } = createRequire(import.meta.url)(
  "@motion-canvas/vite-plugin",
) as { default: typeof import("@motion-canvas/vite-plugin").default };

export default defineConfig({
  plugins: [motionCanvas({ project: "./src/project.ts" })],
  build: {
    emptyOutDir: true,
    outDir: "../../public/animations/motion-canvas",
    rollupOptions: {
      output: {
        entryFileNames: "intro.js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
```

## Astro integration

The root scripts built both projects before development and production builds:

```json
{
  "build:motion-canvas": "pnpm --dir animations/motion-canvas run build",
  "build:animations": "pnpm run build:canvas-commons && pnpm run build:motion-canvas",
  "predev": "pnpm run build:animations",
  "prestart": "pnpm run build:animations",
  "prebuild": "pnpm run generate:assets && pnpm run build:animations"
}
```

The outputs under `public/animations/{canvas-commons,motion-canvas}/` were generated and ignored by Git, Prettier, ESLint, Astro's dev toolbar file watcher, and the root TypeScript project. Cleaning the repository removed those directories too.

Each library had a small Astro wrapper around its custom-element player. The important part was converting the project path to an absolute URL:

```astro
---
const { src, title } = Astro.props;
const projectUrl = new URL(src, Astro.url).href;
---

<motion-canvas-player
  aria-label={title}
  src={projectUrl}
  style="aspect-ratio: 16 / 9"></motion-canvas-player>

<script>
  import "@motion-canvas/player";
</script>
```

The Canvas Commons wrapper only changed the element and package names. A relative `src` failed during development because Vite pre-bundled the player, appended `?import` to its dynamic import, and then rejected the generated module under `public/`. A full URL bypassed that transformation.

The wrappers used CSS `aspect-ratio` rather than `width` and `height` attributes. Both players could react to those attributes before their project defaults had loaded. They were click-to-play, and their figures used `data-pagefind-ignore` so Pagefind did not index player controls.

## Cost of the setup

The result worked, but it required two Vite builds, two generated output trees, a nested workspace with an older Vite and TypeScript, a CommonJS loading shim, pre-build hooks, and custom player URL handling. It also added a large transitive dependency set to `pnpm-lock.yaml`. Those costs were not justified for the two draft examples, so the projects, players, posts, scripts, workspace entry, and dependencies were removed together.
