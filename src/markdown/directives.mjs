const classNames = (node) => {
  const attributes = node.attributes ?? {};
  const authoredClasses = attributes.class ?? attributes.className ?? "";

  return [
    "directive",
    `directive-${node.name}`,
    ...authoredClasses.split(/\s+/).filter(Boolean),
  ];
};

const renderAs = (node, tagName) => {
  const attributes = { ...node.attributes };
  delete attributes.class;
  delete attributes.className;

  return {
    ...node.data,
    hName: tagName,
    hProperties: {
      ...attributes,
      className: classNames(node),
    },
  };
};

/** Render Sätteri directives instead of dropping their nodes. */
export const directivePlugin = {
  name: "render-directives",
  containerDirective(node, context) {
    context.setProperty(node, "data", renderAs(node, "aside"));
  },
  leafDirective(node, context) {
    context.setProperty(node, "data", renderAs(node, "div"));
  },
  textDirective(node, context) {
    context.setProperty(node, "data", renderAs(node, "span"));
  },
};
