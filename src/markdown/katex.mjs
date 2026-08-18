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
      filter: ["pre"],
      visit(node, context) {
        const language = node.properties?.dataLanguage;
        if (language !== "math") return;
        return renderMath(context.textContent(node), true);
      },
    },
  ],
};
