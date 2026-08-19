import { fromHtml } from "hast-util-from-html";
import katex from "katex";

const classNames = (node) => {
  const value = node.properties?.className ?? [];
  return Array.isArray(value) ? value.map(String) : String(value).split(/\s+/);
};

const renderMath = (source, displayMode) => {
  const markup = katex.renderToString(source, {
    displayMode,
    output: "htmlAndMathml",
    throwOnError: false,
  });
  const [rendered] = fromHtml(markup, { fragment: true }).children;
  return rendered;
};

/**
 * Preserve display math before Sätteri's highlighter turns it into an
 * indistinguishable plaintext code block. The built-in paragraph node is
 * required by Sätteri's structural encoder. See docs/markdown-math.md.
 */
export const displayMathPlugin = {
  name: "preserve-display-math",
  math: (node) => ({
    type: /** @type {"paragraph"} */ ("paragraph"),
    data: {
      hName: "div",
      hProperties: { dataMathDisplay: "" },
    },
    children: [{ type: /** @type {"text"} */ ("text"), value: node.value }],
  }),
};

/** Render preserved display nodes and Sätteri's surviving inline math nodes. */
export const katexPlugin = {
  name: "render-katex",
  element: [
    {
      filter: ["code"],
      visit(node, context) {
        if (!classNames(node).includes("math-inline")) return;
        return renderMath(context.textContent(node), false);
      },
    },
    {
      filter: ["div"],
      visit(node, context) {
        if (!("dataMathDisplay" in (node.properties ?? {}))) return;
        return renderMath(context.textContent(node), true);
      },
    },
  ],
};
