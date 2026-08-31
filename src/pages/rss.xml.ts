import rss from "@astrojs/rss";
import type { APIRoute } from "astro";
import { SITE } from "@/site-data";
import { getEntryDate, getEntryPath, getFeedEntries } from "@/lib/posts";

export const GET: APIRoute = async ({ site }) => {
  if (!site) {
    throw new Error("The Astro site URL is required to generate the RSS feed.");
  }

  const entries = await getFeedEntries(false);

  return rss({
    title: SITE.title,
    description: SITE.description,
    site,
    items: entries.map((entry) => ({
      title: entry.data.title,
      description: entry.data.description,
      pubDate: getEntryDate(entry),
      link: getEntryPath(entry),
      categories: entry.data.tags.map((tag) => tag.id),
    })),
  });
};
