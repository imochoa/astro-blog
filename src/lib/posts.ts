import { getCollection, type CollectionEntry } from "astro:content";

export const POSTS_PER_PAGE = 6;

export type PostEntry = CollectionEntry<"posts">;
export type PersonEntry = CollectionEntry<"people">;
export type MediaEntry = CollectionEntry<"books"> | CollectionEntry<"videos">;

function sortPosts(posts: PostEntry[]): PostEntry[] {
  return posts.sort((a, b) => {
    const dateDifference =
      b.data.publishedAt.valueOf() - a.data.publishedAt.valueOf();
    return dateDifference || a.id.localeCompare(b.id);
  });
}

export async function getPosts(
  includeDrafts = import.meta.env.DEV,
): Promise<PostEntry[]> {
  const posts = await getCollection(
    "posts",
    ({ data }) => includeDrafts || !data.draft,
  );

  return sortPosts(posts);
}

export function getMediaPath(entry: MediaEntry): string {
  return `/${entry.collection}/${entry.id}/`;
}

export async function getPostsMentioningPerson(
  person: PersonEntry,
  includeDrafts = import.meta.env.DEV,
): Promise<PostEntry[]> {
  const posts = await getPosts(includeDrafts);

  return posts.filter((post) =>
    post.data.people.some((reference) => reference.id === person.id),
  );
}

export async function getPostsMentioning(
  media: MediaEntry,
  includeDrafts = import.meta.env.DEV,
): Promise<PostEntry[]> {
  const posts = await getPosts(includeDrafts);

  return posts.filter((post) => {
    const references =
      media.collection === "books" ? post.data.books : post.data.videos;
    return references.some((reference) => reference.id === media.id);
  });
}
