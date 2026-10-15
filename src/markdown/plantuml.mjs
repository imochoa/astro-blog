import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_JAR_PATH = "/opt/plantuml/plantuml.jar";
const MAX_SVG_BYTES = 10 * 1024 * 1024;

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

const xmlText = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const safeSvgReference = (value) =>
  /^(?:https?:\/\/|mailto:|#|\/(?!\/)|\.\.?\/)/iu.test(value) ||
  /^data:image\/(?:gif|jpe?g|png|webp);base64,/iu.test(value);

const prefixSvgIds = (svg, prefix) => {
  const ids = [...svg.matchAll(/\bid=(["'])([^"'<>]+)\1/giu)].map(
    (match) => match[2],
  );

  let result = svg;
  for (const id of new Set(ids)) {
    const escaped = id.replaceAll(/[.*+?^$()|[\]\\{}]/gu, "\\$&");
    result = result
      .replaceAll(
        new RegExp("\\bid=([\"'])" + escaped + "\\1", "gu"),
        (value) => value.replace(id, prefix + id),
      )
      .replaceAll(
        new RegExp("url\\(#" + escaped + "\\)", "gu"),
        "url(#" + prefix + id + ")",
      )
      .replaceAll(
        new RegExp("((?:xlink:)?href=([\"']))#" + escaped + "\\2", "gu"),
        "$1#" + prefix + id + "$2",
      );
  }
  return result;
};

/**
 * Keep PlantUML links and native SVG tooltips while preventing authored
 * diagrams from injecting active markup into the article DOM.
 */
export const prepareInteractiveSvg = (svg, { alt, prefix }) => {
  const start = svg.indexOf("<svg");
  if (start < 0)
    throw new Error("PlantUML output does not contain an SVG root");

  let safe = svg.slice(start);
  safe = safe
    .replaceAll(
      /<(?:script|foreignObject|iframe|object|embed)\b[\s\S]*?<\/(?:script|foreignObject|iframe|object|embed)\s*>/giu,
      "",
    )
    .replaceAll(
      /<(?:script|foreignObject|iframe|object|embed)\b[^>]*\/\s*>/giu,
      "",
    )
    .replaceAll(/\son[a-z][\w:-]*\s*=\s*(?:"[^"]*"|'[^']*')/giu, "")
    .replaceAll(
      /\s(?:href|xlink:href)\s*=\s*(["'])(.*?)\1/giu,
      (attribute, _quote, reference) =>
        safeSvgReference(reference) ? attribute : "",
    );

  safe = prefixSvgIds(safe, prefix);
  const titleId = prefix + "title";
  const title = xmlText(alt);
  safe = safe.replace(/<svg\b([^>]*)>/iu, (_root, attributes) => {
    const opening =
      "<svg" +
      attributes +
      ' class="plantuml-image" role="img" aria-labelledby="' +
      titleId +
      '" focusable="false">';
    return opening + '<title id="' + titleId + '">' + title + "</title>";
  });
  return safe;
};

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

/** Render fenced PlantUML blocks to interactive inline SVG at build time. */
export const plantUMLPlugin = {
  name: "render-plantuml",
  async code(node, context) {
    if (node.lang !== "plantuml") return;

    const cwd = context.fileURL
      ? dirname(fileURLToPath(context.fileURL))
      : process.cwd();
    const svg = await renderPlantUML(node.value, cwd);
    const alt = metadataValue(node.meta, "alt") || "PlantUML diagram";
    const identity = [
      context.fileURL ?? "",
      node.position?.start?.offset ?? 0,
      svg,
    ].join(":");
    const prefix =
      "plantuml-" +
      createHash("sha256").update(identity).digest("hex").slice(0, 12) +
      "-";
    const interactiveSvg = prepareInteractiveSvg(svg, { alt, prefix });

    return {
      type: /** @type {"paragraph"} */ ("paragraph"),
      data: {
        hName: "figure",
        hProperties: {
          className: ["plantuml-diagram"],
          dataPagefindIgnore: "",
        },
      },
      children: [
        {
          type: /** @type {"html"} */ ("html"),
          value: interactiveSvg,
        },
      ],
    };
  },
};
