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

type Reference = { collection: string; id: string };

/**
 * Astro 7 only logs dangling `reference()` values during content sync; neither
 * `astro check` nor `astro build` fails. Fail loudly instead of silently
 * dropping a misspelled tag, person, book, or video from the rendered site.
 */
async function assertReferencesExist(): Promise<void> {
  const [posts, books, videos, tags, people] = await Promise.all([
    getCollection("posts"),
    getCollection("books"),
    getCollection("videos"),
    getCollection("tags"),
    getCollection("people"),
  ]);
  const known = new Set(
    [...books, ...videos, ...tags, ...people].map(
      ({ collection, id }: Reference) => `${collection}/${id}`,
    ),
  );
  const owners: [string, Reference[]][] = [
    ...posts.map((post): [string, Reference[]] => [
      `posts/${post.id}`,
      [
        ...post.data.tags,
        ...post.data.people,
        ...post.data.books,
        ...post.data.videos,
      ],
    ]),
    ...books.map((book): [string, Reference[]] => [
      `books/${book.id}`,
      book.data.authors,
    ]),
    ...videos.map((video): [string, Reference[]] => [
      `videos/${video.id}`,
      video.data.creators,
    ]),
  ];
  const missing = owners.flatMap(([owner, references]) =>
    references
      .filter(({ collection, id }) => !known.has(`${collection}/${id}`))
      .map(({ collection, id }) => `${owner} -> ${collection}/${id}`),
  );

  if (missing.length > 0) {
    throw new Error(
      `Content references point to missing entries:\n${missing.join("\n")}`,
    );
  }
}

export async function getPosts(
  includeDrafts = import.meta.env.DEV,
): Promise<PostEntry[]> {
  await assertReferencesExist();

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
