# Technical Document — Copilot Usage Logger

Version: 0.8.0
Audience: engineers maintaining or extending this extension.

## 1. Purpose

VS Code extension that locally logs, classifies, and reports on a developer's
GitHub Copilot Chat usage (requests, cost units/"credits", categories,
languages, models), with no data leaving the machine unless company-wide
reporting is explicitly enabled. It also exposes optional read-only
"knowledge grounding" chat tools (Confluence, Jira, GitHub) so Copilot chat
can cite internal documentation/issues/code.

## 2. Why this exists (design constraints)

There is no public VS Code API to observe requests sent to the built-in
`@copilot` participant — chat participants only see turns explicitly
@-mentioned to them. VS Code Copilot Chat does, however, persist full
conversation history to local JSON files under the user's VS Code profile.
This extension watches and parses those files. The on-disk format is
**undocumented and internal** and may change across VS Code versions without
notice, so every parse entry point is defensive (catches and skips malformed
entries, records `schema_version_seen` and error counts per file rather than
throwing).

Two independent capture paths exist and are deliberately deduplicated:
- **Passive**: a file watcher + parser over VS Code's own chat session files
  (primary, automatic, broad coverage).
- **Participant**: a custom `@usage` chat participant (secondary, explicit,
  fully controlled). Its own turns land in the same session files as normal
  chat, so the ingestor skips entries whose `agent.id` matches the
  extension's own participant id to avoid double-counting.

## 3. High-level architecture

```mermaid
flowchart LR
    subgraph Source of truth
        CSF[VS Code chat session files<br/>workspaceStorage/*/chatSessions/*.json]
    end
    CSF -->|chokidar watch, debounced| FW[watcher/fileWatcher.ts]
    FW --> ING[ingest/ingestor.ts]
    CSF -->|one-time backfill| SCAN[ingest/initialScan.ts]
    SCAN --> ING
    PART["@usage chat participant<br/>participant/usageChatParticipant.ts"] --> ING
    ING --> PARSE[parser/sessionParser.ts]
    ING --> CLASS[classify/classifier.ts]
    ING --> LANG[language/languageDetector.ts]
    ING --> PRIV[privacy/globMatch.ts + sensitiveLabels.ts]
    ING --> DB[(storage/db.ts<br/>sql.js SQLite)]
    DB --> SB[ui/statusBar.ts]
    DB --> DASH[ui/dashboardPanel.ts webview]
    DB --> REPORT[reporting/reportingService.ts]
    REPORT -->|opt-in| MONGO[(MongoDB)]
    REPORT -->|opt-in| HTTP[HTTPS endpoint]
    KNOW["knowledge/* language model tools<br/>Confluence / Jira / GitHub"] -.->|independent of DB| VSLM[vscode.lm chat tools]
```

## 4. Module map (`src/`)

| Module | Responsibility |
|---|---|
| `extension.ts` | `activate()`/`deactivate()`; wires every module below, registers commands, config-change listeners. |
| `discovery/locateUserDataDir.ts` | Derives `<user-data-dir>/User` from `context.globalStorageUri` — portable, no OS-specific hardcoding. |
| `discovery/sessionFileIndex.ts` | Globs `workspaceStorage/<hash>/chatSessions/*.{json,jsonl}` and `globalStorage/emptyWindowChatSessions/*.jsonl`; both roots are discovered, backfilled, and watched. |
| `watcher/fileWatcher.ts` | chokidar watch on both the workspace-scoped and empty-window roots (`watchChatSessionFiles` / `watchEmptyWindowChatSessionFiles`), `awaitWriteFinish` debounce against partial writes. |
| `parser/types.ts` | Loose types reflecting the undocumented, evolving VS Code schema. |
| `parser/sessionParser.ts` | Defensive parser for the workspace snapshot format; never throws. |
| `parser/patchLogParser.ts` | Replays `kind:0` (snapshot) + `kind:1` (keyPath patch) events for the empty-window `.jsonl` format. |
| `classify/categories.ts`, `classify/classifier.ts` | Keyword/regex scoring of prompt text + slash command into a category (code-gen, debug/fix, explain, refactor, test, docs, git/terminal, search/navigate, other). Falls back to `"other"`. Category is stored as free text, not a SQL enum, so the keyword table can be retuned without a migration. |
| `language/extensionMap.ts`, `language/languageDetector.ts` | Detects primary language: attached file extensions first, then fenced code-block language tags in the response, else `"unknown"`. |
| `privacy/globMatch.ts` | Glob matching for `usageLogger.excludedPathGlobs` — matching requests are skipped entirely (not even metadata logged). |
| `privacy/sensitiveLabels.ts` | Keyword-based redaction/labeling support (`usageLogger.sensitiveLabelKeywords`). |
| `storage/schema.ts` | DDL + `PRAGMA user_version` migrations. |
| `storage/db.ts` | sql.js init/load/export/flush; idempotent `insertRequest`; all aggregate queries (counts, credits, group-bys, `creditsByModel`, `creditsByDay`). |
| `ingest/ingestor.ts` | parse → privacy filter → classify → detect language → upsert → advance per-file cursor. Owns the passive/participant dedup rule. |
| `ingest/initialScan.ts` | One-time backfill on activation, wrapped in `withProgress`. |
| `participant/usageChatParticipant.ts` | `@usage` chat participant, `/stats` slash command, logs with `source='participant'`. |
| `ui/statusBar.ts` | `StatusBarItem`, refreshed after each ingest batch; today's request count or (per `usageLogger.statusBarDisplay`) remaining daily credit budget; amber warning once over budget; private-mode lock icon. |
| `ui/dashboardPanel.ts` | Per-user `WebviewPanel`, `postMessage`-driven aggregate data (by category/language/model/day, cost-unit breakdown, burn-rate forecast). |
| `reporting/reportingService.ts` | Optional company-wide reporting scheduler (interval-based). |
| `reporting/reporter.ts`, `mongoReporter.ts`, `payload.ts` | Transport implementations (HTTPS endpoint or MongoDB) and payload shaping; `usageLogger.allowInsecureHttp` gates plaintext HTTP (HTTPS required by default). |
| `reporting/companyAggregate.ts`, `companyDashboardPanel.ts` | Aggregate-view dashboard across reported company-wide data. |
| `reporting/creditsSync.ts` | Multi-device credit reconciliation — lets a user manually enter the real Copilot Business/Enterprise "used" total to fold in usage from other devices (stored in `context.globalState`, resets monthly). |
| `reporting/deviceId.ts` | Stable per-machine device identifier for company-wide reports. |
| `heuristics/modelFit.ts`, `heuristics/timeSavings.ts` | Dashboard heuristics: model-fit suggestions, estimated time savings per category. |
| `export/csvExport.ts` | `usageLogger.exportAuditCsv` — CSV export of logged requests for audit. |
| `knowledge/httpJson.ts` | Shared HTTPS-only, size-capped (5MB), timeout-bounded (10s default) JSON GET helper used by all knowledge clients. |
| `knowledge/atlassianAuth.ts` | Shared Basic-auth (email + API token) builder for Confluence and Jira — one Atlassian API token authenticates both. |
| `knowledge/confluenceClient.ts`, `confluenceText.ts`, `confluenceTools.ts` | `search_confluence` / `get_confluence_page` language model tools. |
| `knowledge/jiraClient.ts`, `jiraText.ts`, `jiraTools.ts` | `search_jira` / `get_jira_issue` language model tools. |
| `knowledge/githubClient.ts`, `githubText.ts`, `githubTools.ts` | `search_github` language model tool (PAT-based, `Authorization: Bearer`). |
| `knowledge/graphText.ts`, `graphClient.ts`, `graphTools.ts` | `search_sharepoint` / `search_teams` language model tools, via Microsoft Graph `/search/query` (Bearer token, short-lived, no OAuth refresh flow). |
| `util/globMatch.ts` | (privacy) glob helper, also reused for path exclusion. |

Pure logic used by unit tests (classifier, language detector, glob matching,
model fit, time savings, and all `*Text.ts` knowledge-tool formatters) is
kept in files with no `vscode` import, since vitest cannot import the
`vscode` module. Vscode-coupled orchestration stays in adjacent files.

## 5. Storage schema (sql.js / SQLite)

```sql
CREATE TABLE requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT, request_id TEXT,
  source TEXT CHECK(source IN ('passive','participant')),
  workspace_hash TEXT, workspace_path TEXT,
  timestamp INTEGER,               -- original request time, epoch ms
  category TEXT,                   -- free text, tunable without migration
  language TEXT,
  model_id TEXT,
  agent_id TEXT, agent_name TEXT,
  prompt_text TEXT,
  response_text TEXT,
  attachments_json TEXT,
  copilot_credits REAL,
  schema_version_seen INTEGER,
  created_at INTEGER,
  UNIQUE(session_id, request_id, source)
);
CREATE INDEX idx_requests_timestamp ON requests(timestamp);
CREATE INDEX idx_requests_category ON requests(category);
CREATE INDEX idx_requests_language ON requests(language);

CREATE TABLE ingestion_state (
  file_path TEXT PRIMARY KEY,
  last_mtime_ms INTEGER, last_size_bytes INTEGER, last_request_count INTEGER,
  last_processed_at INTEGER, schema_version_seen INTEGER,
  parse_error_count INTEGER, last_error TEXT
);
```

`UNIQUE(session_id, request_id, source)` plus per-file cursors in
`ingestion_state` make re-ingestion idempotent: only new/changed requests are
parsed on each pass. `SCHEMA_USER_VERSION` (currently 3) is applied via
`PRAGMA user_version` migrations in `storage/schema.ts`.

**Storage location**: `context.globalStorageUri`, not `context.storageUri`,
because source data spans many workspaces plus global empty-window sessions,
and `context.storageUri` is `undefined` with no folder open. sql.js is
in-memory-first WASM SQLite — the DB is `export()`ed to bytes and written to
disk on a debounced idle timer and in `deactivate()`; rows written between
flushes can be lost on a crash (accepted trade-off, no WAL).

## 6. Data flow (single request, passive path)

1. User sends a Copilot Chat message → VS Code writes/updates a
   `chatSessions/<id>.json` file.
2. chokidar (debounced via `awaitWriteFinish`) fires a change event.
3. `ingestor.ts` re-parses the file via `sessionParser.ts`, using the file's
   `ingestion_state` cursor to only look at new/changed requests.
4. Each new request is checked against `usageLogger.excludedPathGlobs`
   (dropped entirely if matched) and against the extension's own
   participant `agent.id` (dropped if it's `@usage`'s own turn, since that's
   captured directly via the participant path with `source='participant'`).
5. Remaining requests are classified (`classify/classifier.ts`), language
   is detected (`language/languageDetector.ts`), and the row is upserted into
   `requests` (idempotent on the `UNIQUE` constraint).
6. `statusBar.ts` and any open `dashboardPanel.ts` are refreshed.
7. If `usageLogger.enableCompanyWideReporting` is on, `reportingService.ts`
   periodically ships aggregate payloads to the configured HTTPS endpoint or
   MongoDB collection.

## 7. Status bar

`ui/statusBar.ts` shows, per `usageLogger.statusBarDisplay`:
- `"requests"` (default): today's request count, `$(copilot) {n} today`.
- `"remainingCredits"`: remaining cost-unit budget for today, computed from
  `dailyBudgetInfo()` (monthly limit minus credits used before today, divided
  by remaining days in the month, minus today's own spend). Falls back to the
  request-count display if `usageLogger.monthlyCreditLimit` isn't set (budget
  is `null`).
- Private mode (`usageLogger.privateMode`): lock icon, logging paused.
- Amber background/`$(warning)` icon once today's spend meets/exceeds
  today's even daily-budget share, in either display mode.

The setting is read live in `refresh()` (no cached field), and
`extension.ts`'s `onDidChangeConfiguration` listener calls `statusBar.refresh()`
on change so toggling it takes effect immediately, no reload required.

## 8. Dashboard webview

`ui/dashboardPanel.ts` hosts a `WebviewPanel` with inline HTML/CSS/JS (no
charting library — hand-built SVG). `postData()` sends: counts by
category/language/model/day, `creditsByModel()`, `creditsByDay()`,
`projectedMonthEnd` (burn-rate forecast: `(creditsThisMonth / dayOfMonth) *
daysInMonth`, compared against `monthlyCreditLimit`), model-fit and
time-savings heuristics, and multi-device credit sync state. A parallel
`companyDashboardPanel.ts` renders aggregate data reported by other devices
when company-wide reporting is enabled.

## 9. Knowledge tools (Confluence / Jira / GitHub)

Independent of the usage-tracking DB. Each is a read-only
`vscode.lm.registerTool` implementation registered via
`contributes.languageModelTools` (requires `engines.vscode >= 1.95` for the
finalized contribution point):

| Tool | Source | Auth |
|---|---|---|
| `search_confluence`, `get_confluence_page` | Confluence Cloud REST API | Atlassian email + API token (Basic auth) |
| `search_jira`, `get_jira_issue` | Jira Cloud REST API | Same Atlassian email + API token as Confluence |
| `search_github` | GitHub REST/code search API | Personal access token, `Authorization: Bearer`, optionally scoped by `usageLogger.githubOrg` |
| `search_sharepoint`, `search_teams` | Microsoft Graph `/search/query` (`entityTypes: ["driveItem"]` / `["chatMessage"]`) | Microsoft Graph access token (delegated), `Authorization: Bearer` — short-lived (~1h), no refresh flow; user re-runs the set-token command periodically |

Security posture (applies to all three): HTTPS-only (`httpJson.ts` refuses
`http://`), 5MB response cap, 10s default timeout, tokens stored in
`context.secrets` (never in settings.json, never logged), read-only
operations only, and results are bounded by the underlying service's own
permissions (no privilege escalation). The SharePoint/Teams tools share a
single Graph token the same way Confluence/Jira share one Atlassian token,
via the shared `httpPostJson` helper (Graph search is POST, not GET).

## 10. Configuration surface (`contributes.configuration`)

Key settings (see `package.json` for authoritative list/defaults):
`enablePassiveCapture`, `retentionDays`, `privateMode`, `excludedPathGlobs`,
`sensitiveLabelKeywords`, `monthlyCreditLimit`, `statusBarDisplay`,
`timeSavingsMinutesPerCategory`, `enableCompanyWideReporting`,
`reportingEndpointUrl`, `reportingIntervalMinutes`, `reportingTransport`,
`allowInsecureHttp`, `mongoDatabase`, `mongoCollection`,
`confluenceBaseUrl`, `confluenceEmail`, `atlassianEmail`, `jiraBaseUrl`,
`githubOrg`.

Commands (Command Palette, prefix `Copilot Usage:`): Open Dashboard, Open
Company-Wide Dashboard, Rescan Chat History, Purge All Logged Data, Send
Company-Wide Report Now, Set/Clear Reporting API Key, Set/Clear MongoDB
Connection String, Toggle Private Mode, Export Audit CSV, Sync Actual
Credits Used This Month, Set/Clear Confluence API Token, Test Confluence
Connection, Test Jira Connection, Set/Clear GitHub Token, Setup (guided
walkthrough entry point).

## 11. Security posture (OWASP-relevant)

- **No secrets in settings.json**: API tokens (Confluence/Jira, GitHub, Mongo
  connection string, reporting API key) live in `context.secrets`
  (VS Code SecretStorage), not workspace/user settings.
- **Transport security**: all outbound HTTP in `knowledge/httpJson.ts` and
  `reporting/reporter.ts` requires HTTPS by default; plaintext HTTP requires
  explicitly opting in via `usageLogger.allowInsecureHttp` (intended for
  local/dev endpoints only).
- **Bounded I/O**: knowledge-tool responses are capped at 5MB and a 10s
  timeout to avoid unbounded memory/hangs from a compromised or slow
  upstream.
- **Least privilege**: all knowledge tools are read-only and respect the
  underlying service's existing permissions — no writes, no privilege
  escalation.
- **Local-first data**: full prompt/response text is stored unencrypted
  under `context.globalStorageUri`; this is called out prominently in
  `README.md`. Mitigations available to the user: `retentionDays`,
  `purgeData` command, `privateMode`, `excludedPathGlobs`.
- **Idempotent ingestion**: `UNIQUE(session_id, request_id, source)` plus
  per-file cursors prevent duplicate/replayed rows from a re-triggered
  watcher event.
- **Defensive parsing**: the chat session file format is undocumented and
  can change; parsers catch and skip malformed entries per-request rather
  than throwing, and track `schema_version_seen`/error counts for
  diagnosis.

## 12. Build, test, and release

- Type-check: `npx tsc --noEmit`
- Unit tests: `npx vitest run` (currently 65 tests across 9 files; only
  vscode-free modules are covered, per the module-split convention above)
- Lint: `npx eslint src`
- Dev bundle: `node esbuild.js`; production bundle: `node esbuild.js --production`
  (esbuild marks `vscode` and `fsevents` external; a custom plugin copies
  `node_modules/sql.js/dist/sql-wasm.wasm` → `dist/sql-wasm.wasm`, required
  for sql.js WASM init at runtime and must land in the `.vsix`)
- Package: `rm -f *.vsix && npx @vscode/vsce package --no-dependencies --allow-star-activation`
- Local install: `"/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code" --install-extension <vsix> --force`,
  then remove the previous version's extension directory under
  `~/.vscode-insiders/extensions/`
- Release: commit → `git tag vX.Y.Z` → push branch and tag → GitHub Actions
  "CI" and "Release" workflows build/test and attach the `.vsix` to a GitHub
  Release.

## 13. Known limitations / deferred scope

- No public VS Code/GitHub API exposes org-level Copilot premium-request
  quota to third-party extensions; only per-request `copilotCredits` is
  available locally, so cross-device totals rely on the manual
  `creditsSync.ts` reconciliation flow rather than a live API.
- Remote windows (SSH/WSL/Codespaces): `context.globalStorageUri` resolves
  remote-side and may not reflect local chat activity; not a primary target.
- Chat session file format is internal/undocumented and may change across
  VS Code versions without notice.
