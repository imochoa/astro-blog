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
  },
  markdown: {
    shikiConfig: {
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
      mdastPlugins: [directivePlugin],
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
