# Markdown math rendering

The blog renders `$...$` and `$$...$$` with KaTeX at build time. There is no browser-side KaTeX renderer and no CDN dependency. The implementation is in [`src/markdown/katex.mjs`](../src/markdown/katex.mjs), registered in [`astro.config.mjs`](../astro.config.mjs), with the packaged KaTeX CSS imported by [`BasicLayout.astro`](../src/layouts/BasicLayout.astro).

## Why the bridge exists

Sätteri parses both forms when its `math` feature is enabled, but it does not render KaTeX. Inline and display math also reach Sätteri's HAST plugins differently:

- Inline math survives as a `<code class="math-inline">` element.
- Without the MDAST preservation pass, display math looks like a fenced block to the HAST pipeline. Expressive Code claims that block before the KaTeX plugin runs, and the original math identity is no longer available.

A HAST-only plugin can therefore identify inline math, but it cannot safely recover display math after the code renderer has processed it.

## The two-stage workaround

`src/markdown/katex.mjs` deliberately uses one MDAST plugin and one HAST plugin:

1. `displayMathPlugin` runs before Expressive Code. It replaces each display-math MDAST node with a standard `paragraph` node carrying `hName: "div"` and a `dataMathDisplay` marker.
2. A standard `paragraph` node is intentional. Sätteri's structural op-stream accepts it, while an arbitrary custom node type does not.
3. `katexPlugin` runs in the HAST phase. It recognizes either `code.math-inline` or the marked display-math `div` and calls `katex.renderToString()` with the appropriate `displayMode`.
4. KaTeX returns an HTML string. `hast-util-from-html` converts that string into a real HAST element before it replaces the source node. Returning the string directly would escape the KaTeX markup.
5. KaTeX uses `output: "htmlAndMathml"`, so the generated page contains visual HTML and accessible MathML.

The plugin order in `astro.config.mjs` is part of the workaround:

```js
mdastPlugins: [directivePlugin, displayMathPlugin, plantUMLPlugin],
hastPlugins: [expressiveCode(options), katexPlugin],
```

Do not remove `displayMathPlugin`, move display handling back to a `pre` visitor, or change the marker without updating both phases.

The JSDoc literal annotations around `"paragraph"` and `"text"` are also intentional. Without them, JavaScript infers a general `string` for each node type and `astro check` rejects the plugin as incompatible with Sätteri's typed MDAST visitor result.

## Approaches that did not work

These were tested against the current processor and should not be retried without first confirming that Sätteri has changed:

- Looking only for `pre > code.math-display` in the KaTeX plugin: Expressive Code has already replaced that source node by the time the plugin runs.
- Adding a Shiki `math` to `latex` language alias: syntax highlighting the expression still does not render it as math.
- Adding `hProperties` directly to the original MDAST math node: Sätteri's math conversion does not retain that marker.
- Returning a custom MDAST node such as `katexDisplaySource`: Sätteri throws `cannot encode replacement content ... into the structural op-stream`.
- Recovering the original `$$` delimiters from HAST source positions: the rendered code block has no useful source offsets.
- Treating every plaintext code block as math: that would corrupt legitimate unlabelled code examples.

## Assets and runtime behavior

`BasicLayout.astro` imports `katex/dist/katex.min.css`, allowing Vite to bundle the stylesheet and its fonts locally. Keep this import even though the plugin emits the markup itself. Do not add KaTeX auto-render JavaScript, a client hydration directive, or a remote stylesheet.

`throwOnError: false` keeps a malformed expression from aborting the entire static build. Authors should still inspect the rendered result and fix malformed formulas.

## Validation

The current math demonstration is in the draft post `src/content/posts/satteri-and-mdx-features.mdx`. Drafts are deliberately absent from production output, so `just build` alone does not exercise that route visually. Start Astro in development and inspect the draft route:

```sh
just dev
curl -fsS http://localhost:4321/blog/examples/satteri-and-mdx-features/ > /tmp/math-page.html
grep -o 'class="katex"' /tmp/math-page.html | wc -l
# Expected for the current post: 2

grep -o 'class="katex-display"' /tmp/math-page.html | wc -l
# Expected for the current post: 1
```

Also confirm that no source placeholder or escaped renderer output remains:

```sh
! grep -q 'data-math-display' /tmp/math-page.html
! grep -q '&lt;span class=&quot;katex' /tmp/math-page.html
```

Run `just ci` after changing the plugins or configuration. When upgrading Sätteri, retest the draft route as well as CI. If a future version preserves display-math identity through the HAST phase or gains native KaTeX rendering, this bridge can be simplified or removed, but only after verifying inline HTML, display HTML, MathML, local fonts, and dark/light presentation.
