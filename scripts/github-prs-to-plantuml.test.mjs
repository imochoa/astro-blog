import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

import {
  buildModel,
  collectPullRequests,
  renderPlantUML,
} from "./github-prs-to-plantuml.mjs";

const fixture = JSON.parse(
  await readFile(
    new URL("./fixtures/github-prs.json", import.meta.url),
    "utf8",
  ),
);

test("collects native stack members that were not direct search results", () => {
  const collected = collectPullRequests(fixture);

  assert.equal(collected.viewer, "alex");
  assert.equal(collected.total, 5);
  assert.equal(collected.pullRequests.length, 6);
  assert.ok(
    collected.pullRequests.some(
      (pullRequest) =>
        pullRequest.baseRepository.nameWithOwner === "acme/payments" &&
        pullRequest.number === 42,
    ),
  );
});

test("detects GitHub stacks, branch stacks, declared stacks, and forks", () => {
  const model = buildModel(collectPullRequests(fixture), {
    jiraBaseUrl: "https://jira.example.test",
  });
  const relations = model.stackRelations.map(
    ({ lower, upper, kind }) => `${lower}->${upper}:${kind}`,
  );

  assert.equal(model.repositories.length, 3);
  assert.ok(
    model.repositories.some(
      ({ nameWithOwner, parent, isFork }) =>
        nameWithOwner === "dev-forks/payments" &&
        parent === "acme/payments" &&
        isFork,
    ),
  );
  assert.ok(
    relations.includes("acme/payments#41->acme/payments#42:GitHub stack"),
  );
  assert.ok(
    relations.includes("octo-labs/web#8->octo-labs/web#9:branch stack"),
  );
  assert.ok(
    relations.includes("octo-labs/web#9->octo-labs/web#10:declared stack"),
  );
  assert.deepEqual(
    model.jiraTickets.map(({ key }) => key),
    ["DOCS-55", "PAY-101", "PAY-102", "WEB-9"],
  );
  assert.equal(
    model.jiraTickets.find(({ key }) => key === "PAY-102")?.url,
    "https://jira.example.test/browse/PAY-102",
  );
});

test("renders nested owners and repositories with stable relationship aliases", () => {
  const model = buildModel(collectPullRequests(fixture));
  const diagram = renderPlantUML(model, {
    include: "../github-pull-requests.puml",
    title: "Synthetic pull requests",
  });

  assert.match(diagram, /\$GHPR_OWNER_BEGIN\("acme", "organization"/u);
  assert.match(diagram, /\$GHPR_REPO_BEGIN\("dev-forks\/payments"/u);
  assert.match(diagram, /\$GHPR_PR\("acme\/payments#42"/u);
  assert.match(diagram, /\$GHPR_STACK\(ghpr_pr_/u);
  assert.match(diagram, /\$GHPR_FORK\(ghpr_repo_/u);
  assert.match(diagram, /\$GHPR_JIRA\("PAY-101"/u);
  assert.match(diagram, /\$GHPR_REFERENCES\(ghpr_pr_/u);
  assert.match(diagram, /%true\(\)\)/u);
  assert.match(diagram, /Status: approved\\nHead:/u);
  assert.ok(diagram.endsWith("@enduml\n"));
});

test("can disable Jira extraction and expand pull-request nodes", () => {
  const model = buildModel(collectPullRequests(fixture), { jira: false });
  const diagram = renderPlantUML(model, { compact: false });

  assert.deepEqual(model.jiraTickets, []);
  assert.doesNotMatch(diagram, /\$GHPR_JIRA/u);
  assert.match(diagram, /%false\(\)\)/u);
});

test("rejects unsafe Jira base URL protocols", () => {
  assert.throws(
    () =>
      buildModel(collectPullRequests(fixture), {
        jiraBaseUrl: "javascript:alert(1)",
      }),
    /must use http:\/\/ or https:\/\//u,
  );
});
