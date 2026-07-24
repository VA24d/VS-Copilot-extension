# Changelog

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
