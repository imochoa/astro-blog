import { defineCollection, reference } from "astro:content";
import { file, glob } from "astro/loaders";
import { z } from "astro/zod";

const tags = defineCollection({
  loader: file("src/content/tags.json"),
  schema: z.object({
    name: z.string(),
    description: z.string().optional(),
  }),
});

const posts = defineCollection({
  loader: glob({
    base: "./src/content/posts",
    pattern: ["**/*.{md,mdx}", "!**/AGENTS.md"],
  }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishedAt: z.coerce.date(),
    updatedAt: z.coerce.date().optional(),
    socialImage: z.string().startsWith("/").optional(),
    draft: z.boolean().default(false),
    tags: z.array(reference("tags")).default([]),
  }),
});

export const collections = { posts, tags };
