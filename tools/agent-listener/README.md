# Agent listener

Watches this repository's GitHub issues and runs your local coding agent (Claude Code or Codex) on tasks for your role. The PM publishes a task as an issue; your listener claims it, works on it in a worktree inside this repository, pushes a branch and opens a draft PR.

The agent only works inside this repository: each task gets a worktree under `.worktrees/` in your clone, the agent is told not to touch anything outside it, and the listener (not the agent) pushes and opens PRs.

## Install (one time, about 3 minutes)

Requirements: Node 20+, git, GitHub CLI logged in (`gh auth status`), and `claude` or `codex` logged in on your machine.

```bash
git clone https://github.com/API-Experience-Cloud-Bankruptcy/2026_TownPass.git
cd 2026_TownPass
node tools/agent-listener/listener.mjs init --role <web|app|data> --agent <claude|codex>
```

`init` stores your GitHub login, role and agent in `.agent-listener/config.json` (ignored by git). Only issues and `/agent` comments written by trusted accounts (default: the PM, `nangong5421`) trigger work; add more with `--trusted nangong5421,<login>`.

## Run

```bash
node tools/agent-listener/listener.mjs watch
```

Keep it running in a terminal. It checks GitHub every 60 seconds (`--poll <seconds>` at `init` to change) and handles one task at a time. Log: `.agent-listener/listener.log`. Stop with Ctrl+C.

`node tools/agent-listener/listener.mjs once` runs a single check and exits.

## What triggers work

| Event | Condition | Listener action |
|---|---|---|
| New task | Open issue by a trusted account, labels `role:<your role>` and `status:todo`, unassigned or assigned to you | Assign you, label `status:doing`, run the agent in `.worktrees/issue-<n>` on branch `<login>/<n>-<slug>`, push, open a draft PR, label `status:review` |
| Follow-up | Comment starting with `/agent <instruction>` by a trusted account, on an issue or PR this listener handled | Run the agent again on the same branch with the instruction, push, comment on the PR |
| No commits | The agent finished without committing | Comment its output on the issue, label `status:blocked` |

## PM setup (once per repository)

```bash
node tools/agent-listener/listener.mjs setup-labels
```

Creates `role:*`, `status:*` and `contract` labels.

## Agent permissions

- Claude Code runs with `--permission-mode acceptEdits` and only these tools: Read, Edit, Write, Glob, Grep, WebFetch, WebSearch, and Bash for `git`, `npm`, `npx`, `node`, `pnpm`, `flutter`, `dart`, `fvm`, `cargo`; `git push` and `git remote` are denied.
- Codex runs `codex exec --sandbox workspace-write` (writes limited to the worktree) with network access for package installs.
- `--model <name>` at `init` selects a model.
