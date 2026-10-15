import assert from "node:assert/strict";
import test from "node:test";

import { prepareInteractiveSvg } from "./plantuml.mjs";

test("prepares accessible interactive SVG without active markup", () => {
  const source = String.raw`<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg">
  <defs><marker id="arrow"><path d="M0 0"/></marker></defs>
  <script>alert("no")</script>
  <a href="https://example.test/ticket" title="Ticket details" onclick="bad()">
    <text id="label">PAY-101</text>
  </a>
  <a href="javascript:alert(1)"><text>unsafe</text></a>
  <path marker-end="url(#arrow)" aria-labelledby="label"/>
</svg>`;

  const result = prepareInteractiveSvg(source, {
    alt: 'PR map & "tickets"',
    prefix: "diagram-",
  });

  assert.match(result, /<svg[^>]+class="plantuml-image"[^>]+role="img"/u);
  assert.match(
    result,
    /<title id="diagram-title">PR map &amp; &quot;tickets&quot;<\/title>/u,
  );
  assert.match(result, /href="https:\/\/example\.test\/ticket"/u);
  assert.match(result, /title="Ticket details"/u);
  assert.doesNotMatch(result, /javascript:|onclick=|<script/iu);
  assert.match(result, /id="diagram-arrow"/u);
  assert.match(result, /id="diagram-label"/u);
  assert.match(result, /url\(#diagram-arrow\)/u);
});
