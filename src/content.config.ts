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

const people = defineCollection({
  loader: file("src/content/people.json"),
  schema: z.object({
    name: z.string(),
    description: z.string().optional(),
    url: z.url().optional(),
  }),
});

const books = defineCollection({
  loader: file("src/content/books.json"),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    authors: z.array(reference("people")).min(1),
    url: z.url().optional(),
    isbn: z.string().optional(),
    publishedAt: z.coerce.date().optional(),
    readAt: z.coerce.date().optional(),
  }),
});

const videos = defineCollection({
  loader: file("src/content/videos.json"),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    creators: z.array(reference("people")).min(1),
    url: z.url().optional(),
    duration: z.string().optional(),
    publishedAt: z.coerce.date().optional(),
    watchedAt: z.coerce.date().optional(),
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
    draft: z.boolean().default(false),
    tags: z.array(reference("tags")).default([]),
    books: z.array(reference("books")).default([]),
    videos: z.array(reference("videos")).default([]),
    socialImage: z.string().startsWith("/").optional(),
  }),
});

export const collections = { books, people, posts, tags, videos };
