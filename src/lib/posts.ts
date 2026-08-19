import { getCollection, type CollectionEntry } from "astro:content";

export const POSTS_PER_PAGE = 6;

export async function getPosts(
  includeDrafts = import.meta.env.DEV,
): Promise<CollectionEntry<"posts">[]> {
  const posts = await getCollection(
    "posts",
    ({ data }) => includeDrafts || !data.draft,
  );

  return posts.sort((a, b) => {
    const dateDifference =
      b.data.publishedAt.valueOf() - a.data.publishedAt.valueOf();
    return dateDifference || a.id.localeCompare(b.id);
  });
}
