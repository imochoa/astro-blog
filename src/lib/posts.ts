import { getCollection, type CollectionEntry } from "astro:content";

export const POSTS_PER_PAGE = 6;

export type FeedEntry =
  | CollectionEntry<"books">
  | CollectionEntry<"posts">
  | CollectionEntry<"videos">;

export function getEntryDate(entry: FeedEntry): Date {
  switch (entry.collection) {
    case "books":
      return entry.data.readAt;
    case "posts":
      return entry.data.publishedAt;
    case "videos":
      return entry.data.watchedAt;
  }
}

export function getEntryPath(entry: FeedEntry): string {
  switch (entry.collection) {
    case "books":
      return `/books/${entry.id}/`;
    case "posts":
      return `/blog/${entry.id}/`;
    case "videos":
      return `/videos/${entry.id}/`;
  }
}

function sortEntries<T extends FeedEntry>(entries: T[]): T[] {
  return entries.sort((a, b) => {
    const dateDifference =
      getEntryDate(b).valueOf() - getEntryDate(a).valueOf();
    return dateDifference || a.id.localeCompare(b.id);
  });
}

export async function getPosts(
  includeDrafts = import.meta.env.DEV,
): Promise<CollectionEntry<"posts">[]> {
  const posts = await getCollection(
    "posts",
    ({ data }) => includeDrafts || !data.draft,
  );

  return sortEntries(posts);
}

export async function getFeedEntries(
  includeDrafts = import.meta.env.DEV,
): Promise<FeedEntry[]> {
  const [books, posts, videos] = await Promise.all([
    getCollection("books", ({ data }) => includeDrafts || !data.draft),
    getPosts(includeDrafts),
    getCollection("videos", ({ data }) => includeDrafts || !data.draft),
  ]);

  return sortEntries([...books, ...posts, ...videos]);
}
