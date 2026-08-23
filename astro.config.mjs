// @ts-check
import { execFileSync } from "node:child_process";
import { env } from "node:process";
import { URL } from "node:url";
import { defineConfig, logHandlers } from "astro/config";
import { satteri } from "@astrojs/markdown-satteri";
import mdx from "@astrojs/mdx";
import svelte from "@astrojs/svelte";
import sitemap from "@astrojs/sitemap";
import pagefind from "astro-pagefind";
import {
  transformerMetaHighlight,
  transformerMetaWordHighlight,
  transformerNotationDiff,
  transformerNotationErrorLevel,
  transformerNotationFocus,
  transformerNotationHighlight,
  transformerNotationWordHighlight,
} from "@shikijs/transformers";
import { directivePlugin } from "./src/markdown/directives.mjs";
import { displayMathPlugin, katexPlugin } from "./src/markdown/katex.mjs";
import { plantUMLPlugin } from "./src/markdown/plantuml.mjs";
import { SITE } from "./src/site-data.ts";

/** @param {string[]} args */
function runGit(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

const buildCommit = env.SITE_BUILD_COMMIT || runGit(["rev-parse", "HEAD"]);
const buildDate = env.SITE_BUILD_DATE || new Date().toISOString();
const buildDirty = env.SITE_BUILD_DIRTY
  ? env.SITE_BUILD_DIRTY === "true"
  : Boolean(runGit(["status", "--porcelain"]));

// https://astro.build/config
export default defineConfig({
  site: SITE.url,
  integrations: [
    mdx(),
    svelte(),
    sitemap({
      filter: (page) => !/^\/404(?:\/|\.html)?$/.test(new URL(page).pathname),
    }),
    pagefind(),
  ],
  logger: logHandlers.json(),
  vite: {
    define: {
      "import.meta.env.SITE_BUILD_COMMIT": JSON.stringify(
        buildCommit || "unknown",
      ),
      "import.meta.env.SITE_BUILD_DATE": JSON.stringify(buildDate),
      "import.meta.env.SITE_BUILD_DIRTY": JSON.stringify(buildDirty),
    },
    // Draft routes are not part of production's static route scan. Pre-bundle
    // Three.js so its client-only island is still ready on first dev request.
    // Rapier's compat package is already one ESM file with embedded Wasm, and
    // Vite's optimizer fails to emit it reliably. Serve only that package as-is.
    optimizeDeps: {
      include: ["three"],
      exclude: ["@dimforge/rapier3d-compat"],
    },
    // These generated/local directories are not site source and can contain
    // thousands of files. Scanning them over the devcontainer bind mount makes
    // watcher startup unnecessarily slow.
    server: {
      watch: {
        ignored: [
          "**/.output/**",
          "**/.pnpm-store/**",
          "**/astro-course-files/**",
          "**/organizethis/**",
        ],
      },
    },
  },
  markdown: {
    shikiConfig: {
      themes: {
        light: "github-light",
        dark: "github-dark",
      },
      defaultColor: false,
      transformers: [
        transformerMetaHighlight(),
        transformerMetaWordHighlight(),
        transformerNotationDiff(),
        transformerNotationErrorLevel(),
        transformerNotationFocus(),
        transformerNotationHighlight(),
        transformerNotationWordHighlight(),
      ],
    },
    processor: satteri({
      // Keep the display-math preservation pass before the KaTeX HAST pass.
      // Sätteri otherwise highlights display math as indistinguishable plaintext.
      // See docs/markdown-math.md before changing this order.
      mdastPlugins: [directivePlugin, displayMathPlugin, plantUMLPlugin],
      hastPlugins: [katexPlugin],
      features: {
        gfm: true,
        frontmatter: true,
        math: true,
        headingAttributes: true,
        directive: true,
        superscript: true,
        subscript: true,
        wikilinks: true,
        smartPunctuation: true,
      },
    }),
  },
});
