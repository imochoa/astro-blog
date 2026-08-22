// @ts-check
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

// https://astro.build/config
export default defineConfig({
  site: "https://blog.imochoa.com",
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
    // Draft routes are not part of production's static route scan. Pre-bundle
    // Three.js so its client-only island is still ready on first dev request.
    optimizeDeps: { include: ["three"] },
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
