import rss from "@astrojs/rss";
import type { APIRoute } from "astro";
import { getPosts } from "@/lib/posts";

export const GET: APIRoute = async ({ site }) => {
  if (!site) {
    throw new Error("The Astro site URL is required to generate the RSS feed.");
  }

  const posts = await getPosts(false);

  return rss({
    title: "astro-blog",
    description: "A small collection of notes and ideas.",
    site,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.publishedAt,
      link: `/blog/${post.id}/`,
      categories: post.data.tags.map((tag) => tag.id),
    })),
  });
};
