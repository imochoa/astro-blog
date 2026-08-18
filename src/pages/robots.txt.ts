import type { APIRoute } from "astro";

export const GET: APIRoute = ({ site }) => {
  if (!site) {
    throw new Error("The Astro site URL is required to generate robots.txt.");
  }

  const sitemapURL = new URL("sitemap-index.xml", site);
  const body = `User-agent: *
Allow: /

Sitemap: ${sitemapURL.href}
`;

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
