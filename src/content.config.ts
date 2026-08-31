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
    description: z.string(),
    url: z.url().optional(),
  }),
});

const sharedEntryFields = {
  title: z.string(),
  description: z.string(),
  draft: z.boolean().default(false),
  tags: z.array(reference("tags")).default([]),
};

function tagsWith(automaticTag: string) {
  return z.preprocess(
    (value) => {
      const entryTags = Array.isArray(value) ? value : [];
      const hasAutomaticTag = entryTags.some(
        (tag) =>
          tag === automaticTag ||
          (typeof tag === "object" &&
            tag !== null &&
            (("id" in tag && tag.id === automaticTag) ||
              ("slug" in tag && tag.slug === automaticTag))),
      );

      return hasAutomaticTag ? entryTags : [automaticTag, ...entryTags];
    },
    z.array(reference("tags")),
  );
}

const posts = defineCollection({
  loader: glob({
    base: "./src/content/posts",
    pattern: ["**/*.{md,mdx}", "!**/AGENTS.md"],
  }),
  schema: z.object({
    ...sharedEntryFields,
    publishedAt: z.coerce.date(),
    updatedAt: z.coerce.date().optional(),
    socialImage: z.string().startsWith("/").optional(),
  }),
});

const books = defineCollection({
  loader: glob({
    base: "./src/content/books",
    pattern: "**/*.{md,mdx}",
  }),
  schema: z.object({
    ...sharedEntryFields,
    tags: tagsWith("book"),
    authors: z.array(reference("people")).min(1),
    readAt: z.coerce.date(),
    link: z.url().optional(),
  }),
});

const videos = defineCollection({
  loader: glob({
    base: "./src/content/videos",
    pattern: "**/*.{md,mdx}",
  }),
  schema: z.object({
    ...sharedEntryFields,
    tags: tagsWith("video"),
    creators: z.array(reference("people")).min(1),
    watchedAt: z.coerce.date(),
    url: z.url(),
  }),
});

export const collections = { books, people, posts, tags, videos };
