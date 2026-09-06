import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

import { fromHtml } from "hast-util-from-html";

const DEFAULT_JAR_PATH = "/opt/plantuml/plantuml.jar";
const MAX_SVG_BYTES = 10 * 1024 * 1024;
const PLANTUML_THEME = readFileSync(
  new URL("./plantuml-theme.iuml", import.meta.url),
  "utf8",
).trim();
const PAGE_COLORS = new Map([
  ["#FFFDF8", "var(--color-surface)"],
  ["#182235", "var(--color-text)"],
  ["#626977", "var(--color-muted)"],
  ["#B94F38", "var(--color-accent)"],
  ["#F2DCD3", "var(--color-accent-soft)"],
  ["#AEA698", "var(--color-border-strong)"],
  ["#F4B860", "var(--color-highlight)"],
]);
const BLOCKED_SVG_ELEMENTS = new Set([
  "animate",
  "animateMotion",
  "animateTransform",
  "discard",
  "embed",
  "foreignObject",
  "iframe",
  "object",
  "script",
  "set",
  "style",
]);

const metadataValue = (meta, name) => {
  if (!meta) return undefined;

  const match = meta.match(
    new RegExp(`(?:^|\\s)${name}=(?:"([^"]*)"|'([^']*)'|([^\\s]+))`),
  );
  return match?.[1] ?? match?.[2] ?? match?.[3];
};

const completeSource = (source) => {
  if (/^\s*@start[a-z]+\b/im.test(source)) return source;
  return `@startuml\n${source}\n@enduml`;
};

const applyTheme = (source) =>
  completeSource(source).replace(
    /^(\s*@start[a-z]+\b[^\r\n]*)(?:\r?\n|$)/im,
    `$1\n!$BLOG_PLANTUML_MODE = "light"\n${PLANTUML_THEME}\n`,
  );

const renderPlantUML = (source, cwd) =>
  new Promise((resolve, reject) => {
    const jarPath = process.env.PLANTUML_JAR || DEFAULT_JAR_PATH;
    const child = spawn(
      "java",
      [
        "-Djava.awt.headless=true",
        "-jar",
        jarPath,
        "--svg",
        "--pipe",
        "--charset",
        "UTF-8",
        "--disable-metadata",
      ],
      { cwd, stdio: ["pipe", "pipe", "pipe"] },
    );

    const stdout = [];
    const stderr = [];
    let outputSize = 0;
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(error);
    };

    child.on("error", (error) => {
      fail(
        new Error(
          `Could not start PlantUML. Check Java and PLANTUML_JAR: ${error.message}`,
        ),
      );
    });

    child.stdout.on("data", (chunk) => {
      outputSize += chunk.length;
      if (outputSize > MAX_SVG_BYTES) {
        fail(new Error("PlantUML generated an SVG larger than 10 MiB"));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => stderr.push(chunk));

    child.on("close", (code) => {
      if (settled) return;
      settled = true;

      const diagnostic = Buffer.concat(stderr).toString("utf8").trim();
      if (code !== 0) {
        reject(
          new Error(
            `PlantUML exited with code ${code}${diagnostic ? `:\n${diagnostic}` : ""}`,
          ),
        );
        return;
      }

      const svg = Buffer.concat(stdout).toString("utf8");
      if (!svg.includes("<svg")) {
        reject(
          new Error(
            `PlantUML did not return SVG${diagnostic ? `:\n${diagnostic}` : ""}`,
          ),
        );
        return;
      }

      resolve(svg);
    });

    child.stdin.on("error", (error) => fail(error));
    child.stdin.end(completeSource(source), "utf8");
  });

const withPageColors = (svg) => {
  let themed = svg;
  for (const [color, variable] of PAGE_COLORS) {
    themed = themed.replaceAll(new RegExp(color, "gi"), variable);
  }
  return themed;
};

const safeUrl = (value, allowRasterData = false) => {
  const url = String(value).trim();
  if (url.startsWith("#")) return true;
  if (/^(?:https?:|mailto:)/i.test(url)) return true;
  if (/^(?:\/(?!\/)|\.\.?\/)/.test(url)) return true;
  return (
    allowRasterData && /^data:image\/(?:gif|jpeg|png|webp);base64,/i.test(url)
  );
};

const sanitizeSvg = (node) => {
  if (node.type !== "element") return node.type === "text" ? node : undefined;
  if (BLOCKED_SVG_ELEMENTS.has(node.tagName)) return undefined;

  for (const [name, value] of Object.entries(node.properties ?? {})) {
    if (/^on/i.test(name)) {
      delete node.properties[name];
      continue;
    }

    if (name === "href" || name === "xLinkHref") {
      if (!safeUrl(value, node.tagName === "image")) {
        delete node.properties[name];
      }
      continue;
    }

    if (
      name === "style" &&
      /(?:@import|expression\s*\(|javascript:|url\s*\(\s*["']?(?!#))/i.test(
        String(value),
      )
    ) {
      delete node.properties[name];
    }
  }

  node.children = (node.children ?? [])
    .map(sanitizeSvg)
    .filter((child) => child !== undefined);
  return node;
};

const prefixSvgIds = (svg, prefix) => {
  const ids = new Map();

  const collect = (node) => {
    if (node.type !== "element") return;
    if (node.properties?.id) {
      const id = String(node.properties.id);
      ids.set(id, `${prefix}-${id}`);
      node.properties.id = ids.get(id);
    }
    node.children?.forEach(collect);
  };

  const rewrite = (node) => {
    if (node.type !== "element") return;

    for (const [name, value] of Object.entries(node.properties ?? {})) {
      if (name === "id" || typeof value !== "string") continue;

      if ((name === "href" || name === "xLinkHref") && value.startsWith("#")) {
        node.properties[name] = `#${ids.get(value.slice(1)) ?? value.slice(1)}`;
        continue;
      }

      if (name === "ariaLabelledBy" || name === "ariaDescribedBy") {
        node.properties[name] = value
          .split(/\s+/)
          .map((id) => ids.get(id) ?? id)
          .join(" ");
        continue;
      }

      node.properties[name] = value.replace(
        /url\(\s*(["']?)#([^)'"\s]+)\1\s*\)/g,
        (match, quote, id) =>
          ids.has(id) ? `url(${quote}#${ids.get(id)}${quote})` : match,
      );
    }

    node.children?.forEach(rewrite);
  };

  collect(svg);
  rewrite(svg);
};

const inlineSvg = (source, alt, idPrefix) => {
  const parsed = fromHtml(withPageColors(source), { fragment: true });
  const svg = parsed.children.find(
    (child) => child.type === "element" && child.tagName === "svg",
  );
  if (!svg) throw new Error("Could not parse PlantUML SVG output");

  sanitizeSvg(svg);
  prefixSvgIds(svg, idPrefix);

  const titleId = `${idPrefix}-title`;
  svg.properties = {
    ...svg.properties,
    ariaLabelledBy: titleId,
    className: ["plantuml-image"],
    focusable: "false",
    preserveAspectRatio: "xMidYMid meet",
    role: "img",
  };
  delete svg.properties.style;
  svg.children.unshift({
    type: "element",
    tagName: "title",
    properties: { id: titleId },
    children: [{ type: "text", value: alt }],
  });
  return /** @type {import("hast").Element} */ (svg);
};

/** Render fenced `plantuml` blocks to an inline SVG placeholder at build time. */
export const plantUMLPlugin = {
  name: "render-plantuml",
  async code(node, context) {
    if (node.lang !== "plantuml") return;

    const cwd = context.fileURL
      ? dirname(fileURLToPath(context.fileURL))
      : process.cwd();
    const svg = await renderPlantUML(applyTheme(node.value), cwd);
    const alt = metadataValue(node.meta, "alt") || "PlantUML diagram";
    const location = node.position?.start;
    const idPrefix = `plantuml-${createHash("sha256")
      .update(
        `${context.fileURL ?? "unknown"}:${location?.line ?? 0}:${location?.column ?? 0}:${node.value}`,
      )
      .digest("hex")
      .slice(0, 12)}`;

    return {
      type: /** @type {"paragraph"} */ ("paragraph"),
      data: {
        hName: "figure",
        hProperties: {
          className: ["plantuml-diagram"],
          dataPagefindIgnore: "",
          dataPlantumlAlt: alt,
          dataPlantumlIdPrefix: idPrefix,
          dataPlantumlSvg: "",
        },
      },
      children: [{ type: /** @type {"text"} */ ("text"), value: svg }],
    };
  },
};

/** Parse, sanitize, and insert rendered PlantUML markup into its figure. */
export const plantUMLHastPlugin = {
  name: "inline-plantuml",
  element: [
    {
      filter: ["figure"],
      visit(node, context) {
        if (!("dataPlantumlSvg" in (node.properties ?? {}))) return;

        const alt = String(node.properties.dataPlantumlAlt);
        const idPrefix = String(node.properties.dataPlantumlIdPrefix);
        const properties = { ...node.properties };
        delete properties.dataPlantumlAlt;
        delete properties.dataPlantumlIdPrefix;
        delete properties.dataPlantumlSvg;

        return {
          type: /** @type {"element"} */ ("element"),
          tagName: "figure",
          properties,
          children: [inlineSvg(context.textContent(node), alt, idPrefix)],
        };
      },
    },
  ],
};
