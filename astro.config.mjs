// @ts-check
import { defineConfig, logHandlers } from "astro/config";
import { satteri } from "@astrojs/markdown-satteri";
// https://astro.build/config
export default defineConfig({
  logger: logHandlers.json(),
  markdown: {
    processor: satteri({
      features: { directive: true, math: true, headingAttributes: true },
    }),
  },
});
