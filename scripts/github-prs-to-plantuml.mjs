import { execFileSync } from "node:child_process";
import console from "node:console";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";

const DEFAULT_QUERY = "is:pr is:open author:@me archived:false";
const DEFAULT_INCLUDE = "plantuml/github-pull-requests.puml";
const DEFAULT_JIRA_BASE_URL = process.env.JIRA_BASE_URL || "";

const GRAPHQL_QUERY = String.raw`
  query OpenPullRequests($searchQuery: String!, $after: String) {
    viewer {
      login
    }
    search(query: $searchQuery, type: ISSUE, first: 100, after: $after) {
      issueCount
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        ... on PullRequest {
          ...PullRequestFields
          stack {
            id
            number
            size
            baseRefName
            entries(first: 100) {
              nodes {
                position
                pullRequest {
                  ...PullRequestFields
                }
              }
            }
          }
          stackEntry {
            position
          }
        }
      }
    }
  }

  fragment PullRequestFields on PullRequest {
    number
    title
    url
    bodyText
    state
    isDraft
    reviewDecision
    mergeStateStatus
    baseRefName
    headRefName
    isCrossRepository
    baseRepository {
      nameWithOwner
      isFork
      owner {
        login
        __typename
      }
      parent {
        nameWithOwner
        isFork
        owner {
          login
          __typename
        }
      }
    }
    headRepository {
      nameWithOwner
      isFork
      owner {
        login
        __typename
      }
      parent {
        nameWithOwner
        isFork
        owner {
          login
          __typename
        }
      }
    }
  }
`;

const compareText = (left, right) =>
  left.localeCompare(right, "en", { numeric: true, sensitivity: "base" });

const asPages = (fixture) => (Array.isArray(fixture) ? fixture : [fixture]);

const responseData = (page) => page.data ?? page;

const repositoryName = (repository) => repository?.nameWithOwner ?? "";

const pullRequestKey = (pullRequest) => {
  const repository = repositoryName(pullRequest.baseRepository);
  return repository && pullRequest.number
    ? `${repository}#${pullRequest.number}`
    : "";
};

const normalizedOwnerKind = (owner) =>
  owner?.__typename === "Organization" ? "organization" : "user";

const repositoryRecord = (repository) => {
  if (!repository?.nameWithOwner) return undefined;
  const [fallbackOwner, ...nameParts] = repository.nameWithOwner.split("/");
  return {
    nameWithOwner: repository.nameWithOwner,
    owner: repository.owner?.login || fallbackOwner,
    ownerKind: normalizedOwnerKind(repository.owner),
    name: nameParts.join("/"),
    isFork: Boolean(repository.isFork),
    parent: repository.parent?.nameWithOwner || "",
    parentOwner: repository.parent?.owner?.login || "",
    parentOwnerKind: normalizedOwnerKind(repository.parent?.owner),
  };
};

const mergePullRequest = (pullRequests, candidate, stack) => {
  const key = pullRequestKey(candidate);
  if (!key) return;

  const previous = pullRequests.get(key) ?? {};
  pullRequests.set(key, {
    ...previous,
    ...candidate,
    stack: candidate.stack ?? previous.stack ?? stack?.metadata ?? null,
    stackEntry:
      candidate.stackEntry ??
      previous.stackEntry ??
      (stack ? { position: stack.position } : null),
  });
};

export function collectPullRequests(pages) {
  const pullRequests = new Map();
  let viewer = "";
  let total = 0;

  for (const page of asPages(pages)) {
    const data = responseData(page);
    viewer ||= data.viewer?.login || "";
    total = Math.max(total, data.search?.issueCount ?? 0);

    for (const node of data.search?.nodes ?? []) {
      if (!node?.number || !node.baseRepository) continue;
      mergePullRequest(pullRequests, node);

      const stack = node.stack;
      if (!stack) continue;
      const metadata = {
        id: stack.id,
        number: stack.number,
        size: stack.size,
        baseRefName: stack.baseRefName,
      };

      for (const entry of stack.entries?.nodes ?? []) {
        if (!entry?.pullRequest) continue;
        mergePullRequest(pullRequests, entry.pullRequest, {
          metadata,
          position: entry.position,
        });
      }
    }
  }

  return {
    viewer,
    total,
    pullRequests: [...pullRequests.values()],
  };
}

const addRepository = (repositories, repository) => {
  const record = repositoryRecord(repository);
  if (!record) return;
  const previous = repositories.get(record.nameWithOwner);
  repositories.set(record.nameWithOwner, {
    ...record,
    ...previous,
    isFork: record.isFork || previous?.isFork || false,
    parent: record.parent || previous?.parent || "",
    parentOwner: record.parentOwner || previous?.parentOwner || "",
    parentOwnerKind:
      record.parentOwnerKind || previous?.parentOwnerKind || "user",
  });

  if (record.parent && !repositories.has(record.parent)) {
    const [owner, ...nameParts] = record.parent.split("/");
    repositories.set(record.parent, {
      nameWithOwner: record.parent,
      owner: record.parentOwner || owner,
      ownerKind: record.parentOwnerKind,
      name: nameParts.join("/"),
      isFork: false,
      parent: "",
      parentOwner: "",
      parentOwnerKind: "user",
    });
  }
};

const reviewStatus = (pullRequest) => {
  if (pullRequest.isDraft) return "draft";
  switch (pullRequest.reviewDecision) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes-requested";
    case "REVIEW_REQUIRED":
      return "review-required";
    default:
      return "open";
  }
};

const branchKey = (repository, branch) => `${repository}:${branch}`;

const addBranch = (branches, repository, branch, role) => {
  if (!repository || !branch) return;
  const key = branchKey(repository, branch);
  const previous = branches.get(key);
  const roles = new Set(previous?.roles ?? []);
  roles.add(role);
  branches.set(key, { key, repository, branch, roles });
};

const stackId = (pullRequest) => pullRequest.stack?.id ?? "";

const nativeStackRelations = (pullRequests) => {
  const stacks = new Map();
  for (const pullRequest of pullRequests) {
    const id = stackId(pullRequest);
    const position = pullRequest.stackEntry?.position;
    if (!id || !position) continue;
    const entries = stacks.get(id) ?? [];
    entries.push({ pullRequest, position });
    stacks.set(id, entries);
  }

  const relations = [];
  for (const [id, entries] of stacks) {
    entries.sort((left, right) => left.position - right.position);
    for (let index = 1; index < entries.length; index += 1) {
      relations.push({
        lower: pullRequestKey(entries[index - 1].pullRequest),
        upper: pullRequestKey(entries[index].pullRequest),
        kind: "GitHub stack",
        source: `github:${id}`,
      });
    }
  }
  return relations;
};

const branchStackRelations = (pullRequests, nativeKeys) => {
  const relations = [];
  for (const upper of pullRequests) {
    const upperKey = pullRequestKey(upper);
    if (stackId(upper) || nativeKeys.has(upperKey)) continue;

    for (const lower of pullRequests) {
      const lowerKey = pullRequestKey(lower);
      if (upperKey === lowerKey) continue;
      const targetRepository = repositoryName(upper.baseRepository);
      const sourceRepository = repositoryName(lower.headRepository);
      if (
        targetRepository === sourceRepository &&
        upper.baseRefName === lower.headRefName
      ) {
        relations.push({
          lower: lowerKey,
          upper: upperKey,
          kind: "branch stack",
          source: "branches",
        });
      }
    }
  }
  return relations;
};

const declaredStackRelations = (pullRequests, knownKeys) => {
  const relations = [];
  const referencePattern =
    /(?:depends\s+on|stacked\s+on|built\s+on)\s+(?:(?:https:\/\/github\.com\/)?([\w.-]+\/[\w.-]+)(?:\/pull\/|#)|#)(\d+)/giu;

  for (const upper of pullRequests) {
    const upperKey = pullRequestKey(upper);
    for (const match of upper.bodyText?.matchAll(referencePattern) ?? []) {
      const repository = match[1] || repositoryName(upper.baseRepository);
      const lower = `${repository}#${match[2]}`;
      if (!knownKeys.has(lower) || lower === upperKey) continue;
      relations.push({
        lower,
        upper: upperKey,
        kind: "declared stack",
        source: "description",
      });
    }
  }
  return relations;
};

const uniqueStackRelations = (relations) => {
  const unique = new Map();
  for (const relation of relations) {
    const key = `${relation.lower}->${relation.upper}`;
    const previous = unique.get(key);
    if (!previous || relation.source.startsWith("github:")) {
      unique.set(key, relation);
    }
  }
  return [...unique.values()];
};

const jiraUrl = (baseUrl, key) => {
  const base = baseUrl.replace(/\/+$/u, "");
  if (!base) return "";
  if (!/^https?:\/\//iu.test(base)) {
    throw new Error("Jira base URL must use http:// or https://");
  }
  return base.endsWith("/browse") ? base + "/" + key : base + "/browse/" + key;
};

const collectJiraTickets = (pullRequests, baseUrl) => {
  const tickets = new Map();
  const keyPattern = /(?<![A-Z0-9_])([A-Z][A-Z0-9_]{1,19}-\d+)(?![A-Z0-9_])/giu;
  const urlPattern =
    /(https?:\/\/[^\s<>"')\]]+\/browse\/([A-Z][A-Z0-9_]{1,19}-\d+))(?![A-Z0-9_])/giu;

  const reference = (pullRequest, keyValue, source, explicitUrl = "") => {
    const key = keyValue.toUpperCase();
    const ticket = tickets.get(key) ?? {
      key,
      url: jiraUrl(baseUrl, key),
      references: new Map(),
    };
    if (explicitUrl) ticket.url = explicitUrl;

    const pullRequestReference =
      ticket.references.get(pullRequestKey(pullRequest)) ?? new Set();
    pullRequestReference.add(source);
    ticket.references.set(pullRequestKey(pullRequest), pullRequestReference);
    tickets.set(key, ticket);
  };

  for (const pullRequest of pullRequests) {
    const fields = [
      ["title", pullRequest.title],
      ["description", pullRequest.bodyText],
      ["head branch", pullRequest.headRefName],
    ];

    for (const [source, value] of fields) {
      const text = String(value ?? "");
      for (const match of text.matchAll(urlPattern)) {
        reference(pullRequest, match[2], source, match[1]);
      }
      for (const match of text.matchAll(keyPattern)) {
        reference(pullRequest, match[1], source);
      }
    }
  }

  return [...tickets.values()]
    .map((ticket) => ({
      ...ticket,
      references: [...ticket.references].map(([pullRequest, sources]) => ({
        pullRequest,
        sources: [...sources].sort(compareText),
      })),
    }))
    .sort((left, right) => compareText(left.key, right.key));
};

export function buildModel(
  collected,
  {
    heuristicStacks = true,
    jiraBaseUrl = DEFAULT_JIRA_BASE_URL,
    jira = true,
  } = {},
) {
  const pullRequests = [...collected.pullRequests].sort((left, right) =>
    compareText(pullRequestKey(left), pullRequestKey(right)),
  );
  const repositories = new Map();
  const branches = new Map();

  for (const pullRequest of pullRequests) {
    addRepository(repositories, pullRequest.baseRepository);
    addRepository(repositories, pullRequest.headRepository);
    addBranch(
      branches,
      repositoryName(pullRequest.baseRepository),
      pullRequest.baseRefName,
      "base",
    );
    addBranch(
      branches,
      repositoryName(pullRequest.headRepository),
      pullRequest.headRefName,
      "head",
    );
  }

  const pullRequestKeys = new Set(pullRequests.map(pullRequestKey));
  const nativeRelations = nativeStackRelations(pullRequests);
  const nativeKeys = new Set(
    nativeRelations.flatMap(({ lower, upper }) => [lower, upper]),
  );
  const inferredRelations = heuristicStacks
    ? [
        ...branchStackRelations(pullRequests, nativeKeys),
        ...declaredStackRelations(pullRequests, pullRequestKeys),
      ]
    : [];

  return {
    ...collected,
    pullRequests,
    repositories: [...repositories.values()].sort((left, right) =>
      compareText(left.nameWithOwner, right.nameWithOwner),
    ),
    branches: [...branches.values()].sort((left, right) =>
      compareText(left.key, right.key),
    ),
    jiraTickets: jira ? collectJiraTickets(pullRequests, jiraBaseUrl) : [],
    stackRelations: uniqueStackRelations([
      ...nativeRelations,
      ...inferredRelations,
    ]),
  };
}

const safeText = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "”")
    .replaceAll(/[\r\n]+/gu, " ")
    .trim();

const quoted = (value) => `"${safeText(value)}"`;

const tooltipText = (lines) =>
  lines
    .filter(Boolean)
    .map((line) =>
      safeText(line)
        .replaceAll("{", "(")
        .replaceAll("}", ")")
        .replaceAll("[", "(")
        .replaceAll("]", ")"),
    )
    .join("\\n");

const aliasesFor = (model) => {
  const owners = new Map();
  const repositories = new Map();
  const branches = new Map();
  const pullRequests = new Map();
  const jiraTickets = new Map();

  const ownerNames = [...new Set(model.repositories.map(({ owner }) => owner))]
    .filter(Boolean)
    .sort(compareText);
  ownerNames.forEach((owner, index) =>
    owners.set(owner, `ghpr_owner_${index + 1}`),
  );
  model.repositories.forEach((repository, index) =>
    repositories.set(repository.nameWithOwner, `ghpr_repo_${index + 1}`),
  );
  model.branches.forEach((branch, index) =>
    branches.set(branch.key, `ghpr_branch_${index + 1}`),
  );
  model.pullRequests.forEach((pullRequest, index) =>
    pullRequests.set(pullRequestKey(pullRequest), `ghpr_pr_${index + 1}`),
  );
  model.jiraTickets.forEach((ticket, index) =>
    jiraTickets.set(ticket.key, "ghpr_jira_" + (index + 1)),
  );

  return { owners, repositories, branches, pullRequests, jiraTickets };
};

const roleLabel = (roles) => {
  const hasBase = roles.has("base");
  const hasHead = roles.has("head");
  if (hasBase && hasHead) return "base / head branch";
  if (hasBase) return "base branch";
  return "head branch";
};

const pullRequestTooltip = (pullRequest, jiraKeys) =>
  tooltipText([
    pullRequestKey(pullRequest),
    pullRequest.title,
    "Status: " + reviewStatus(pullRequest).replaceAll("-", " "),
    "Head: " +
      repositoryName(pullRequest.headRepository) +
      ":" +
      pullRequest.headRefName,
    "Base: " +
      repositoryName(pullRequest.baseRepository) +
      ":" +
      pullRequest.baseRefName,
    jiraKeys.length ? "Jira: " + jiraKeys.join(", ") : "",
  ]);

const jiraTooltip = (ticket) =>
  tooltipText([
    "Jira ticket " + ticket.key,
    "Referenced by:",
    ...ticket.references.map(
      ({ pullRequest, sources }) =>
        pullRequest + " (" + sources.join(", ") + ")",
    ),
  ]);

export function renderPlantUML(
  model,
  {
    include = DEFAULT_INCLUDE,
    title = "Open GitHub pull requests",
    query = DEFAULT_QUERY,
    compact = true,
  } = {},
) {
  const aliases = aliasesFor(model);
  const jiraKeysByPullRequest = new Map();
  for (const ticket of model.jiraTickets) {
    for (const reference of ticket.references) {
      const keys = jiraKeysByPullRequest.get(reference.pullRequest) ?? [];
      keys.push(ticket.key);
      jiraKeysByPullRequest.set(reference.pullRequest, keys);
    }
  }
  const lines = [
    "@startuml",
    `' Generated by scripts/github-prs-to-plantuml.mjs`,
    `' Search: ${safeText(query)}`,
    `!include ${include}`,
    "",
    `title ${safeText(title)}`,
    "top to bottom direction",
    "",
  ];

  const repositoriesByOwner = Map.groupBy(
    model.repositories,
    ({ owner }) => owner,
  );
  const branchesByRepository = Map.groupBy(
    model.branches,
    ({ repository }) => repository,
  );
  const pullRequestsByRepository = Map.groupBy(
    model.pullRequests,
    (pullRequest) => repositoryName(pullRequest.baseRepository),
  );

  for (const [owner, repositories] of [...repositoriesByOwner].sort(
    ([left], [right]) => compareText(left, right),
  )) {
    const ownerKind = repositories[0]?.ownerKind || "owner";
    lines.push(
      `$GHPR_OWNER_BEGIN(${quoted(owner)}, ${quoted(ownerKind)}, ${quoted(aliases.owners.get(owner))})`,
    );

    for (const repository of repositories) {
      lines.push(
        `$GHPR_REPO_BEGIN(${quoted(repository.nameWithOwner)}, ${quoted(aliases.repositories.get(repository.nameWithOwner))}, ${quoted(repository.parent)})`,
      );

      for (const branch of branchesByRepository.get(repository.nameWithOwner) ??
        []) {
        lines.push(
          `$GHPR_BRANCH(${quoted(branch.key)}, ${quoted(aliases.branches.get(branch.key))}, ${quoted(roleLabel(branch.roles))})`,
        );
      }

      for (const pullRequest of pullRequestsByRepository.get(
        repository.nameWithOwner,
      ) ?? []) {
        const key = pullRequestKey(pullRequest);
        lines.push(
          "$GHPR_PR(" +
            [
              quoted(key),
              quoted(pullRequest.title),
              quoted(pullRequest.headRefName),
              quoted(pullRequest.baseRefName),
              quoted(reviewStatus(pullRequest)),
              quoted(aliases.pullRequests.get(key)),
              quoted(
                pullRequestTooltip(
                  pullRequest,
                  jiraKeysByPullRequest.get(key) ?? [],
                ),
              ),
              compact ? "%true()" : "%false()",
            ].join(", ") +
            ")",
        );
      }

      lines.push("$GHPR_END()", "");
    }
    lines.push("$GHPR_END()", "");
  }

  if (model.jiraTickets.length) {
    lines.push('$GHPR_JIRA_BEGIN("Jira", "ghpr_jira_container")');
    for (const ticket of model.jiraTickets) {
      lines.push(
        "$GHPR_JIRA(" +
          [
            quoted(ticket.key),
            quoted(""),
            quoted(ticket.url),
            quoted(jiraTooltip(ticket)),
            quoted(aliases.jiraTickets.get(ticket.key)),
            "%true()",
          ].join(", ") +
          ")",
      );
    }
    lines.push("$GHPR_END()", "");
  }

  for (const pullRequest of model.pullRequests) {
    const pullRequestAlias = aliases.pullRequests.get(
      pullRequestKey(pullRequest),
    );
    const headBranchAlias = aliases.branches.get(
      branchKey(
        repositoryName(pullRequest.headRepository),
        pullRequest.headRefName,
      ),
    );
    const baseBranchAlias = aliases.branches.get(
      branchKey(
        repositoryName(pullRequest.baseRepository),
        pullRequest.baseRefName,
      ),
    );
    if (headBranchAlias) {
      lines.push(`$GHPR_OPENS(${headBranchAlias}, ${pullRequestAlias})`);
    }
    if (baseBranchAlias) {
      lines.push(`$GHPR_TARGETS(${pullRequestAlias}, ${baseBranchAlias})`);
    }
  }

  for (const ticket of model.jiraTickets) {
    const ticketAlias = aliases.jiraTickets.get(ticket.key);
    for (const reference of ticket.references) {
      const pullRequestAlias = aliases.pullRequests.get(reference.pullRequest);
      if (pullRequestAlias && ticketAlias) {
        lines.push(
          "$GHPR_REFERENCES(" + pullRequestAlias + ", " + ticketAlias + ")",
        );
      }
    }
  }

  for (const relation of model.stackRelations) {
    const lower = aliases.pullRequests.get(relation.lower);
    const upper = aliases.pullRequests.get(relation.upper);
    if (lower && upper) {
      lines.push(`$GHPR_STACK(${lower}, ${upper}, ${quoted(relation.kind)})`);
    }
  }

  for (const repository of model.repositories) {
    if (!repository.isFork || !repository.parent) continue;
    const fork = aliases.repositories.get(repository.nameWithOwner);
    const upstream = aliases.repositories.get(repository.parent);
    if (fork && upstream) lines.push(`$GHPR_FORK(${fork}, ${upstream})`);
  }

  lines.push("", "$GHPR_LEGEND()", "@enduml", "");
  return lines.join("\n");
}

const fetchGitHubPages = (searchQuery) => {
  const pages = [];
  let after = "";

  do {
    const args = [
      "api",
      "graphql",
      "-f",
      `query=${GRAPHQL_QUERY}`,
      "-F",
      `searchQuery=${searchQuery}`,
    ];
    if (after) args.push("-F", `after=${after}`);

    const page = JSON.parse(
      execFileSync("gh", args, {
        encoding: "utf8",
        maxBuffer: 20 * 1024 * 1024,
      }),
    );
    if (page.errors?.length) {
      throw new Error(page.errors.map(({ message }) => message).join("\n"));
    }
    pages.push(page);
    after = page.data?.search?.pageInfo?.hasNextPage
      ? page.data.search.pageInfo.endCursor
      : "";
  } while (after);

  return pages;
};

const usage = `Usage:
  node scripts/github-prs-to-plantuml.mjs [options]

Options:
  --query <query>       GitHub issue-search query
  --fixture <path>      Read synthetic/captured GraphQL JSON instead of GitHub
  --output <path>       Write the diagram to a file instead of stdout
  --include <path>      PlantUML include path emitted in the diagram
  --title <text>        Diagram title
  --jira-base-url <url> Build Jira links as <url>/browse/KEY
  --no-jira             Disable Jira key detection
  --expanded            Show PR details in nodes instead of only on hover
  --no-heuristic-stacks Disable branch/body stack inference
  --help                Show this help

Default query: ${DEFAULT_QUERY}
`;

const parseArguments = (arguments_) => {
  const options = {
    query: DEFAULT_QUERY,
    include: DEFAULT_INCLUDE,
    title: "Open GitHub pull requests",
    heuristicStacks: true,
    jiraBaseUrl: DEFAULT_JIRA_BASE_URL,
    jira: true,
    compact: true,
  };

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const next = () => {
      index += 1;
      if (index >= arguments_.length) {
        throw new Error(`${argument} requires a value`);
      }
      return arguments_[index];
    };

    switch (argument) {
      case "--query":
        options.query = next();
        break;
      case "--fixture":
        options.fixture = next();
        break;
      case "--output":
        options.output = next();
        break;
      case "--include":
        options.include = next();
        break;
      case "--title":
        options.title = next();
        break;
      case "--jira-base-url":
        options.jiraBaseUrl = next();
        break;
      case "--no-jira":
        options.jira = false;
        break;
      case "--expanded":
        options.compact = false;
        break;
      case "--no-heuristic-stacks":
        options.heuristicStacks = false;
        break;
      case "--help":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
};

export async function main(arguments_ = process.argv.slice(2)) {
  const options = parseArguments(arguments_);
  if (options.help) {
    process.stdout.write(usage);
    return;
  }

  const pages = options.fixture
    ? JSON.parse(await readFile(options.fixture, "utf8"))
    : fetchGitHubPages(options.query);
  const collected = collectPullRequests(pages);
  const model = buildModel(collected, {
    heuristicStacks: options.heuristicStacks,
    jiraBaseUrl: options.jiraBaseUrl,
    jira: options.jira,
  });
  const diagram = renderPlantUML(model, options);

  if (options.output) {
    await writeFile(options.output, diagram, "utf8");
    console.error(
      `Wrote ${model.pullRequests.length} pull requests, ${model.jiraTickets.length} Jira tickets, and ${model.repositories.length} repositories to ${options.output}`,
    );
  } else {
    process.stdout.write(diagram);
  }
}

const isEntryPoint =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
