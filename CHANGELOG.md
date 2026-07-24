# Changelog

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
