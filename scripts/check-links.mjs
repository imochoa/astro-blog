import console from "node:console";
import process from "node:process";
import { URL } from "node:url";
import { check } from "linkinator";

const port = 32123;
const localHosts = new Set(["127.0.0.1", "localhost", "blog.imochoa.com"]);

const result = await check({
  path: "dist",
  port,
  recurse: true,
  cleanUrls: true,
  checkCss: true,
  checkFragments: true,
  urlRewriteExpressions: [
    {
      pattern: /^https:\/\/blog\.imochoa\.com/,
      replacement: `http://localhost:${port}`,
    },
  ],
  linksToSkip: async (link) => {
    const url = new URL(link);

    if (url.protocol === "http:" || url.protocol === "https:") {
      return !localHosts.has(url.hostname);
    }

    return true;
  },
});

const checkedLinks = result.links.filter(({ state }) => state !== "SKIPPED");
const brokenLinks = result.links.filter(({ state }) => state === "BROKEN");

if (brokenLinks.length > 0) {
  console.error("Broken internal links:");
  for (const { status, url } of brokenLinks) {
    console.error(`- ${status || "error"}: ${url}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Checked ${checkedLinks.length} internal links.`);
}
