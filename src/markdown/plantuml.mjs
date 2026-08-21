import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
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

/** Render fenced `plantuml` blocks to isolated SVG data images at build time. */
export const plantUMLPlugin = {
  name: "render-plantuml",
  async code(node, context) {
    if (node.lang !== "plantuml") return;

    const cwd = context.fileURL
      ? dirname(fileURLToPath(context.fileURL))
      : process.cwd();
    const svg = await renderPlantUML(node.value, cwd);
    const alt = metadataValue(node.meta, "alt") || "PlantUML diagram";

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
          type: /** @type {"image"} */ ("image"),
          url: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
          alt,
          title: null,
          data: {
            hProperties: {
              className: ["plantuml-image"],
              decoding: "async",
              loading: "lazy",
            },
          },
        },
      ],
    };
  },
};
