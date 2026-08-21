import console from "node:console";
import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const faviconSource = path.join(projectRoot, "src/assets/favicon.svg");
const socialImageSource = path.join(
  projectRoot,
  "public/social/default-og.svg",
);

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

await Promise.all([
  assertReadable(faviconSource),
  assertReadable(socialImageSource),
]);

await Promise.all(
  icons.map(async ({ size, output }) => {
    const png = await sharp(faviconSource)
      .resize(size, size, {
        fit: "contain",
        background: "#f8f6f0",
      })
      .png()
      .toBuffer();

    await writeIfChanged(path.join(projectRoot, output), png);
  }),
);

const socialImage = await sharp(socialImageSource)
  .resize(1200, 630, { fit: "fill" })
  .png()
  .toBuffer();
await writeIfChanged(
  path.join(projectRoot, "public/social/default-og.png"),
  socialImage,
);
