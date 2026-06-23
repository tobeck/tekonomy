---
# Sortie workflow for tekonomy.
# Run with: sortie /path/to/tekonomy/WORKFLOW.md
tracker:
  kind: github
  api_key: $SORTIE_GITHUB_TOKEN # fine-grained PAT, scoped to tobeck/tekonomy
  project: tobeck/tekonomy
  query_filter: 'label:agent'
  active_states: [agent:todo, agent:doing]
  in_progress_state: agent:doing
  handoff_state: agent:review
  terminal_states: [agent:done]

agent:
  kind: claude-code
  command: claude
  max_concurrent_agents: 1
  max_sessions: 3
  max_turns: 4

claude-code:
  permission_mode: bypassPermissions
  model: sonnet
  effort: medium
  max_turns: 60
  max_budget_usd: 3

polling:
  interval_ms: 60000

workspace:
  root: /var/lib/sortie/workspaces/tekonomy
db_path: /var/lib/sortie/tekonomy.db

hooks:
  after_create: |
    git clone https://github.com/tobeck/tekonomy.git .
    corepack enable
    corepack prepare pnpm@11.5.3 --activate
    pnpm install --frozen-lockfile
  before_run: |
    git fetch origin main
    git checkout -B "sortie/issue-$SORTIE_ISSUE_IDENTIFIER" origin/main
    pnpm install --frozen-lockfile
  after_run: |
    set -e
    if [ "$(git rev-list --count origin/main..HEAD)" -gt 0 ]; then
      git push -u origin "sortie/issue-$SORTIE_ISSUE_IDENTIFIER"
      gh pr create --base main --head "sortie/issue-$SORTIE_ISSUE_IDENTIFIER" \
        --title "sortie #$SORTIE_ISSUE_IDENTIFIER" --body "Closes #$SORTIE_ISSUE_IDENTIFIER" \
        2>/dev/null || echo "PR already exists"
      gh issue edit "$SORTIE_ISSUE_IDENTIFIER" --remove-label agent 2>/dev/null || true
    fi
---

You are a senior engineer working a single issue to completion in an isolated
checkout on branch `sortie/issue-{{ .issue.identifier }}`.

## Issue #{{ .issue.identifier }}: {{ .issue.title }}

{{ .issue.description }}

Read CLAUDE.md first; it is the contract. Implement the issue, add/update tests,
run the project's lint/typecheck/test/build and make them pass, and commit your
work referencing #{{ .issue.identifier }}. Stay within the issue's Agent-Paths.
Do not push or open PRs (the hooks do that). Raise out-of-scope problems as
`FOLLOWUP: <title> :: <detail>`; if blocked, prefix your final message `BLOCKED:`.
