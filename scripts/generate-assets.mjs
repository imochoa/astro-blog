import { Buffer } from "node:buffer";
import console from "node:console";
import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { SITE } from "../src/site-data.ts";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const faviconSource = path.join(projectRoot, "src/assets/favicon.svg");

const icons = [
  { size: 180, output: "public/icons/apple-touch-icon.png" },
  { size: 192, output: "public/icons/icon-192.png" },
  { size: 512, output: "public/icons/icon-512.png" },
];

async function assertReadable(source) {
  try {
    await access(source, constants.R_OK);
  } catch {
    throw new Error(`Asset source is missing or unreadable: ${source}`);
  }
}

async function writeIfChanged(output, contents) {
  let current;

  try {
    current = await readFile(output);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const relativeOutput = path.relative(projectRoot, output);
  if (current?.equals(contents)) {
    console.log(`Unchanged ${relativeOutput}`);
    return;
  }

  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, contents);
  console.log(`Generated ${relativeOutput}`);
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function wrapWords(value, maxLineLength) {
  return value.split(/\s+/u).reduce((lines, word) => {
    const currentLine = lines.at(-1);
    if (!currentLine || currentLine.length + word.length + 1 > maxLineLength) {
      lines.push(word);
    } else {
      lines[lines.length - 1] = `${currentLine} ${word}`;
    }
    return lines;
  }, []);
}

function createSocialImageSvg(favicon) {
  const encodedFavicon = favicon.toString("base64");
  const descriptionLines = wrapWords(SITE.description, 54)
    .slice(0, 2)
    .map(
      (line, index) =>
        `  <text x="128" y="${422 + index * 46}" fill="#a7b3af" font-family="system-ui, sans-serif" font-size="34">${escapeXml(line)}</text>`,
    )
    .join("\n");

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
  <defs>
    <clipPath id="logo-clip">
      <rect x="128" y="136" width="112" height="112" rx="25" />
    </clipPath>
  </defs>
  <rect width="1200" height="630" fill="#111714" />
  <rect x="72" y="72" width="1056" height="486" rx="32" fill="#19211e" stroke="#33413c" stroke-width="4" />
  <rect x="128" y="136" width="112" height="112" rx="25" fill="#f8f6f0" />
  <image x="128" y="136" width="112" height="112" preserveAspectRatio="xMidYMid slice" clip-path="url(#logo-clip)" href="data:image/svg+xml;base64,${encodedFavicon}" />
  <text x="128" y="350" fill="#e7eeeb" font-family="system-ui, sans-serif" font-size="76" font-weight="700">${escapeXml(SITE.title)}</text>
${descriptionLines}
</svg>
`);
}

function createWebManifest() {
  return Buffer.from(
    `${JSON.stringify(
      {
        name: SITE.title,
        short_name: SITE.title,
        description: SITE.description,
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#f6f8f7",
        theme_color: "#36665a",
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
}

await assertReadable(faviconSource);
const favicon = await readFile(faviconSource);
const socialImageSvg = createSocialImageSvg(favicon);

await Promise.all([
  ...icons.map(async ({ size, output }) => {
    const png = await sharp(favicon)
      .resize(size, size, {
        fit: "contain",
        background: "#f8f6f0",
      })
      .png()
      .toBuffer();

    await writeIfChanged(path.join(projectRoot, output), png);
  }),
  (async () => {
    await writeIfChanged(
      path.join(projectRoot, "public/social/default-og.svg"),
      socialImageSvg,
    );

    const socialImage = await sharp(socialImageSvg)
      .resize(1200, 630, { fit: "fill" })
      .png()
      .toBuffer();
    await writeIfChanged(
      path.join(projectRoot, "public/social/default-og.png"),
      socialImage,
    );
  })(),
  writeIfChanged(
    path.join(projectRoot, "public/site.webmanifest"),
    createWebManifest(),
  ),
]);
