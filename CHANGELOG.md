# Changelog

## 0.7.0

- Add: **Jira knowledge tools** — `search_jira` and `get_jira_issue` (`#jira` / `#jiraIssue`) ground chat answers in your org's Jira issues. Reuses the same Atlassian email + API token as Confluence; only `usageLogger.jiraBaseUrl` is new. Read-only, HTTPS-only, permission-honoring.
- Add: **GitHub knowledge tool** — `search_github` (`#github`) searches your org's issues/PRs, code, or repositories beyond the open workspace. Store a PAT via "Copilot Usage: Set GitHub Token" (secret storage); optionally scope with `usageLogger.githubOrg`.
- Add: **Cost units by model** dashboard card — shows which models actually consume your Copilot cost units (sum of `copilotCredits` per model).
- Add: **Burn-rate forecast** — dashboard projects month-end spend vs. your `monthlyCreditLimit` and flags over/under; the status bar item turns amber once today's spend meets/exceeds today's even budget share.
- Add: **Getting-started walkthrough** (Help → Get Started) and a **"Copilot Usage: Setup"** command for guided configuration of credits, Confluence, Jira, GitHub, and MongoDB.
- Internal: shared HTTPS-JSON + Atlassian-auth helpers extracted (vscode-free, unit-tested); 65 tests total.

## 0.6.0

- Add: Confluence knowledge integration. Two read-only language-model tools — `search_confluence` and `get_confluence_page` — let Copilot chat (agent mode, or `#confluence` / `#confluencePage`) ground answers in your organization's Confluence Cloud wiki (internal standards, runbooks, architecture, onboarding, policies). Configure `usageLogger.confluenceBaseUrl` + `usageLogger.confluenceEmail`, then store an Atlassian API token via "Copilot Usage: Set Confluence API Token" (kept in secret storage, never in settings.json). Auth is HTTP Basic over HTTPS only; the token is never logged; results are size-capped; and the tools honor your existing Confluence permissions. Also adds "Clear Confluence API Token" and "Test Confluence Connection" commands. Minimum VS Code raised to 1.95 (finalized languageModelTools contribution point).

## 0.5.0

- Add: multi-device credits sync. This extension only observes local Copilot activity, but a Business/Enterprise seat's credit quota is shared across every device the account uses — usage on other machines was previously invisible, silently understating the daily-budget figures. New command "Copilot Usage: Sync Actual Credits Used This Month" (also reachable via a button on the dashboard and a link in the status bar hover tooltip) lets you enter the real "used" total from the native Copilot Business/Enterprise flyout; the gap vs. local tracking is stored for the current calendar month (`context.globalState`, auto-resets each month) and folded into the monthly total, remaining, and daily-budget math everywhere it's shown.

## 0.4.3

- Fix: daily-budget math was double-counting today's own credit spend — it was folded into the monthly remaining pool *before* dividing by days left, then subtracted again when showing "used today" / "remaining today". Now the day's even share is computed from credits used **before** today, so today's usage is only subtracted once. Affects the dashboard's "Today's budget" bar and the status bar's "Remaining today" figure (both previously understated the true daily allotment).

## 0.4.2

- Add: status bar hover tooltip now shows a text progress bar and remaining cost units for today's daily budget (mirrors the dashboard's daily-budget math: remaining monthly credits ÷ remaining days in month). Falls back to a "not set" line when `usageLogger.monthlyCreditLimit` is unconfigured.

## 0.4.1

- Change: status bar item now has a stable id (`usageLogger.statusBar`) and a rich Markdown hover tooltip (requests today, cost units today, all-time total) instead of a single-line string.

## 0.4.0

- Add: rich custom hover panel on the credits card (remaining/daily-budget breakdown + inline sparkline of recent daily cost-unit trend), replacing plain-text native tooltips.
- Fix: daily trend queries (`groupByDay`, `creditsByDay`) now bucket by local calendar day instead of UTC, matching the daily-budget bar's "today" boundary.
- Add: `LICENSE` (proprietary, all rights reserved) and `license: UNLICENSED` in package.json.
- Add: unit test suite (vitest) covering classifier, language detector, model-fit/time-savings heuristics, company aggregation, glob matching, and sensitive-label detection; wired into a new CI workflow (type-check + lint + tests on every push/PR) and into the release workflow (tests must pass before a tagged release is packaged).

## 0.3.0

- Add: hover tooltips on the credits card show remaining balance, daily budget, and reset date.
- Add: "Today's budget" progress bar (remaining credits this month ÷ remaining days in month vs. today's usage).
- Docs: document the company-wide Mongo dashboard setup in README.
- Build: exclude `.github/` from the packaged vsix.

## 0.2.0

- Fix: language detection now scans agent-mode tool-call file paths (`textEditGroup`/`codeblockUri`), cutting "unknown" from ~98% to ~46% of requests.
- Add: Copilot cost-unit ("credits") tracking with monthly limit + trend chart, selectable 7/30/90/180-day window.
- Add: model-fit heuristic (flags over/under-powered model choices per task).
- Add: estimated time-savings heuristic per category.
- Add: company-wide dashboard reading aggregated reports from a shared MongoDB collection.
- Fix: schema migration now backfills `copilot_credits` on pre-existing rows via upsert instead of `INSERT OR IGNORE`.

## 0.1.0

- Initial MVP: passive chat-session-file watcher, keyword classifier, language detector, sql.js storage, status bar, dashboard webview, `@usage` chat participant.
