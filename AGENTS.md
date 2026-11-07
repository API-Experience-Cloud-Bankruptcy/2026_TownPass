# Team and agent rules

This repository is a fork of Taipei's Town Pass app. Our hackathon microservice, 「臺北市福利補助自己查」, is a web page opened inside Town Pass. Three people work on it, each with their own AI coding agent (Claude Code or Codex), on separate machines. GitHub is the only shared channel: issues, branches, pull requests and review comments. Every agent reads this file before working.

## Layout

| Path | Content | Owner role |
|---|---|---|
| `microservice/welfare/` | Microservice web app (Expo Router, exported as a static web page) | Web |
| `microservice/welfare/src/data/` | Welfare items, questions, schema | Data |
| `lib/` | Town Pass Flutter app: service entry, web-message handlers | App |
| `docs/` | Design document, contracts, demo script | PM |
| `docs/contracts/` | Interfaces shared between roles | PM approves changes |

Stay inside your role's paths. A change outside them needs a comment on the issue first.

## Workflow

1. Work only from an issue. Pick an open issue with label `status:todo`, assign yourself, switch the label to `status:doing`, and comment your plan in at most five lines.
2. Branch from the latest `main`: `<github-id>/<issue-number>-<short-slug>`, e.g. `phillychi3/12-bridge-userinfo`.
3. Keep a pull request small: one issue, one PR. Open it as a draft early; mark it ready when the checks below pass.
4. PR title is the main commit title (format below). The body says `Closes #<issue>`, what changed, how it was verified (commands and results), and screenshots for UI.
5. Review: every PR needs one approval from another person (or their agent posting a review). The PM merges with **squash merge**. Do not merge your own PR.
6. Blocked for more than 15 minutes: label `status:blocked`, comment what you need and from whom.
7. Before starting new work and before opening a PR: `git fetch origin && git rebase origin/main`.

## Commit rules

- Format: `<Type>: <繁體中文短描述，約 20 字內>`. Types: `Feat`, `Fix`, `Refactor`, `Docs`, `Test`, `Chore`, `Style`.
  - Example: `Feat: 結果頁顯示還需要確認的條件`
- Body (optional): at most three lines in Traditional Chinese on what the user sees or what behaviour changed.
- One logical change per commit. No "fix typo of previous commit" commits before review: amend or fixup locally.
- Never commit secrets, `.env` files, API keys, build outputs (`build/`, `dist/`, `node_modules/`, `.dart_tool/`) or generated files not already tracked.
- Never force-push `main`. Force-push only your own branch.
- Agent co-author trailers are allowed.

## Contracts

Interfaces between roles live in `docs/contracts/`. Change them only through a PR labelled `contract`, approved by the PM, and announce it on every affected issue.

- `docs/contracts/bridge.md`: messages between the microservice page and Town Pass.
- `microservice/welfare/src/data/welfare-schema.ts`: data model for welfare items and the user profile.

## Quality bar

- Web: `npx tsc --noEmit`, unit tests, and screenshots at 375px wide in light theme; no horizontal scroll; touch targets at least 48px; text readable at the largest font setting.
- Flutter: `flutter analyze` and `flutter test` pass; `dart run build_runner build` after changing generated sources.
- Data: every welfare item has an official source URL and a `checkedAt` date; unverifiable conditions go into `eligibility.notes`, never guessed.
- UI copy is Traditional Chinese: titles, labels, values and errors. No filler sentences.
- Do not use the Taipei City Government logo or claim the service is official.

## Communication

- Status lives on issues, not in chat: comment when you start, when you hit a decision, and when you open the PR.
- Disagreement with a plan or contract: comment on the issue with the reason and a proposal. The PM decides within the hour and records the decision on the issue.
