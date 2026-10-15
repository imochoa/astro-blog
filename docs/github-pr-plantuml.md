# GitHub pull-request maps with PlantUML

This repository contains two related tools:

- [`plantuml/github-pull-requests.puml`](../plantuml/github-pull-requests.puml)
  is a reusable PlantUML include for owner, repository, branch, pull-request,
  fork, and stack elements.
- [`scripts/github-prs-to-plantuml.mjs`](../scripts/github-prs-to-plantuml.mjs)
  queries GitHub through the authenticated `gh` CLI and emits a complete
  PlantUML diagram using that include.

The checked-in fixture and blog examples use invented repositories. Do not
commit output from a live query until you have checked it for private repository
names, branch names, and pull-request titles.

## Import the library

Use a path relative to the diagram being rendered:

```plantuml
@startuml
!include_once ../plantuml/github-pull-requests.puml

$GHPR_DEFAULTS("acme", "payments")

$GHPR_OWNER_BEGIN("acme", "organization", "org_acme")
$GHPR_REPO_BEGIN("", "repo_payments")
$GHPR_BRANCH("main", "branch_main", "base branch")
$GHPR_BRANCH("feature/api", "branch_api", "head branch")
$GHPR_PR("#41", "Add authorization API", "feature/api", "main", "approved", "pr_41")
$GHPR_END()
$GHPR_END()

$GHPR_OPENS(branch_api, pr_41)
$GHPR_TARGETS(pr_41, branch_main)
$GHPR_LEGEND()
@enduml
```

`$GHPR_DEFAULTS` lets pull-request specs become progressively shorter:

| Spec               | Resolution                                |
| ------------------ | ----------------------------------------- |
| `acme/payments#41` | Explicit owner, repository, and PR        |
| `payments#41`      | Default owner, explicit repository and PR |
| `#41` or `41`      | Default owner and repository              |

Repository specs similarly accept `owner/repository`, `repository`, or an empty
string. Branch specs accept `owner/repository:branch`, `repository:branch`,
`:branch`, or just the branch when both defaults are set.

Every element accepts an explicit alias. The library generates one when it is
omitted and writes it to `$GHPR_LAST_ID`, but explicit aliases are clearer for
relationships:

```plantuml
$GHPR_OPENS(branch_api, pr_41)
$GHPR_TARGETS(pr_41, branch_main)
$GHPR_STACK(pr_41, pr_42, "GitHub stack")
$GHPR_FORK(repo_contributor, repo_upstream)
```

The status argument to `$GHPR_PR` supports `open`, `draft`, `approved`,
`review-required`, and `changes-requested`.

## Hover details and compact nodes

The final two `$GHPR_PR` arguments are an optional tooltip and compact-mode
flag. PlantUML writes the tooltip into its SVG hyperlink. Compact mode keeps
only the PR number visible while the title, review state, head, base, and Jira
keys remain available on hover:

```plantuml
$GHPR_PR(
  "#41",
  "Add authorization API",
  "feature/api",
  "main",
  "approved",
  "pr_41",
  "PR #41\nAdd authorization API\nStatus: approved\nHead: feature/api\nBase: main",
  %true()
)
```

Generated diagrams use compact mode by default. Pass `--expanded` to retain the
title and branches inside every PR node. Hover details require interactive SVG;
the Astro renderer therefore sanitizes and embeds PlantUML output inline rather
than placing it in an `<img>`.

## Jira tickets

The library renders Jira tickets as purple cards, separate from GitHub PR
rectangles:

```plantuml
$GHPR_JIRA_BEGIN("Jira", "jira_tickets")
$GHPR_JIRA(
  "PAY-101",
  "",
  "https://jira.example.test/browse/PAY-101",
  "Jira ticket PAY-101\nReferenced by acme/payments#41",
  "jira_pay_101"
)
$GHPR_END()

$GHPR_REFERENCES(pr_41, jira_pay_101)
```

The generator detects Jira keys in PR titles, descriptions, and head-branch
names. A full URL ending in `/browse/KEY-123` is preserved. Bare keys use
`--jira-base-url` or the `JIRA_BASE_URL` environment variable:

```sh
node scripts/github-prs-to-plantuml.mjs \
  --jira-base-url https://jira.example.test \
  --output /tmp/open-pull-requests.puml
```

Use `--no-jira` when issue-like strings should not be detected. The generator
does not contact Jira, so summaries and workflow status are not available unless
they are authored manually with `$GHPR_JIRA`. Jira tooltips list the PRs and
fields where each key was found.

## Generate a map from GitHub

The default query selects open pull requests authored by the authenticated user:

```sh
node scripts/github-prs-to-plantuml.mjs \
  --output /tmp/open-pull-requests.puml
```

Run the output from the repository root because its default include is
`plantuml/github-pull-requests.puml`. Override the include when the output lives
somewhere else:

```sh
node scripts/github-prs-to-plantuml.mjs \
  --query 'is:pr is:open org:acme involves:@me' \
  --include ../shared/github-pull-requests.puml \
  --output ../diagrams/acme-pull-requests.puml
```

Use GitHub search qualifiers to choose authored PRs, review requests, a specific
organization, or any other useful view. `--help` lists all generator options.

## Stack detection

The generator uses three signals, in this order:

1. GitHub's native GraphQL `stack` and `stackEntry` fields. It also adds stack
   members that were not direct results of the search query.
2. A branch relationship where one open PR targets another open PR's head
   branch in the same repository.
3. A PR description containing `depends on`, `stacked on`, or `built on`,
   followed by `#123`, `owner/repository#123`, or a GitHub PR URL.

Native stack metadata wins when multiple signals describe the same edge. Pass
`--no-heuristic-stacks` to show only native GitHub stacks.

## Fork detection

For each PR, the GraphQL query reads both the base and head repositories. A head
repository marked as a fork is placed in its own owner container and linked to
its parent repository. The head branch remains inside the fork while the PR and
base branch remain inside the upstream repository.

## Tests

The test fixture models a native stack, a branch-based stack, a
description-based stack, a contributor fork, and Jira references from titles,
descriptions, and branch names without using live account data:

```sh
just test-github-prs
```

The Astro posts also render diagrams through the pinned PlantUML JAR during a
production build, exercising the include and its short spec forms.
