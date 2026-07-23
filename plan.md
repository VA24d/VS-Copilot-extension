# Copilot Usage Logger — VS Code Extension

## Context

User wants own VS Code extension: log Copilot Chat requests, classify by type (code-gen, debug/fix, explain, refactor, test, docs, git/terminal, search/navigate, other), track language per request, track usage volume over time. All local, nothing uploaded.

Researched first: pulled current VS Code Chat Participant API / Language Model API docs, and checked whether an existing tool already covers this (GitHub's official Copilot Usage Metrics API + `copilot-metrics-viewer` dashboard). Verdict: that official tool is **org/enterprise admin** aggregate reporting (acceptance rate, active users, per-language breakdown across a whole org) via a GitHub App with "Organization Copilot metrics: Read" — it does not expose per-request logs or classification for a single developer's own usage, so it's not a fit. Not building on it.

Key finding that shapes the whole design: **there is no public VS Code API to observe requests sent to the built-in `@copilot` participant.** Chat participants only see messages explicitly @-mentioned to them. However, VS Code Copilot Chat persists full conversation history to local JSON files under the user's VS Code profile — confirmed by directly inspecting real files on this machine (77 real session files found). Prior art exists doing exactly this: `github.com/digitarald/vscode-session-trace`, a shipped extension that watches these files and indexes them into SQLite.

Confirmed schema (VS Code 1.130.0, chat session `version: 3`):
- `workspaceStorage/<hash>/chatSessions/<id>.json` — full-snapshot session file. `requests[]` entries have `requestId, message.text (raw prompt), agent.id, modelId, timestamp, response[]` (response parts include `kind`-less parts holding markdown response text — where fenced code-block language tags live), `variableData.variables[]` (attached file refs with `fsPath`, useful for language detection).
- `globalStorage/emptyWindowChatSessions/*.jsonl` — **different format**: append-only event log, line 0 is a full snapshot (`{kind:0, v:<session>}`), later lines are patches (`{kind:1, k:[<keyPath>], v:<value>}`). Reconstructing state means replaying patches. More complex than the workspace format.
- `<user-data-dir>/User` is locatable portably (no OS-specific hardcoding) via `path.join(context.globalStorageUri.fsPath, '..', '..')`.
- Format is **undocumented/internal**, may shift across VS Code versions without notice — parser must be defensive everywhere.

User's architecture decisions (locked in, confirmed via question):
- **Capture: both** — (a) passive watcher/parser over the local chat session files (primary, broad, automatic), and (b) a custom `@usage` chat participant via `vscode.chat.createChatParticipant` + `vscode.lm` (secondary, fully-controlled path, invoked explicitly).
- **Data: full prompt + response text** stored locally (not metadata-only) — richer classification, searchable history. Never leaves the machine.
- **Storage: SQLite via `sql.js` (WASM)** — avoids native-module build/prebuild complications for packaging.
- **UI: status bar item** (running/today count) that opens a **webview dashboard** (charts/tables by category, language, model, day).
- **Deliverable: packaged `.vsix`** via `vsce package` — final artifact, not just F5 dev-host testing.

## Scaffolding

`npx --package yo --package generator-code -- yo code` → New Extension (TypeScript), esbuild bundler, npm. Gives correct `.vscodeignore`, `launch.json`, `tsconfig.json`, `esbuild.js` out of the box — matters because `sql.js`'s `.wasm` asset must end up inside the `.vsix`, easy to get wrong by hand.

Dependencies: `sql.js` + `@types/sql.js`; `chokidar` (recursive watch is unreliable via raw `fs.watch` on Linux; `awaitWriteFinish` gives built-in debounce against partial writes). No charting library — hand-built inline SVG in the webview.

`engines.vscode`: verify against changelog for when `chat.createChatParticipant` / `vscode.lm` stabilized, target that as floor (~1.93+).

### package.json contribution points
- `activationEvents: ["onStartupFinished"]`
- `contributes.commands`: `usageLogger.openDashboard`, `usageLogger.rescanHistory` (manual backfill), `usageLogger.purgeData` (privacy control)
- `contributes.chatParticipants`: one entry, `@usage`, with a `/stats` slash command
- `contributes.configuration`: `usageLogger.enablePassiveCapture` (bool, default true), `usageLogger.retentionDays` (default 0 = unlimited) — near-MVP given full raw text is stored, not deferred polish

## Module breakdown

```
src/
  extension.ts                        — activate()/deactivate(), wires modules
  discovery/locateUserDataDir.ts      — derive <user-data-dir>/User from context.globalStorageUri
  discovery/sessionFileIndex.ts       — glob workspaceStorage/*/chatSessions/*.json + globalStorage/emptyWindowChatSessions/*.jsonl
  watcher/fileWatcher.ts              — chokidar on both roots, debounced change events
  parser/types.ts                     — loose types reflecting undocumented/evolving schema
  parser/sessionParser.ts             — defensive parser, workspace snapshot format; never throws, records schema_version_seen
  parser/emptyWindowLogParser.ts      — kind0/kind1 patch-log replay parser (see scope note below)
  classify/categories.ts              — category list + keyword tables, data-driven (not hardcoded enum)
  classify/classifier.ts              — keyword/regex scoring over prompt text + slash command, falls back to "other"
  language/extensionMap.ts            — file extension → language label
  language/languageDetector.ts        — primary: attached file extensions; secondary: fenced code-block tags; fallback "unknown"
  storage/db.ts                       — sql.js init/load/export/flush, insertRequest (idempotent), aggregate queries
  storage/schema.ts                   — DDL + PRAGMA user_version migrations
  ingest/ingestor.ts                  — parse → classify → detect language → upsert → update cursor; owns passive/participant de-dup rule
  ingest/initialScan.ts               — one-time backfill on activation, wrapped in withProgress
  participant/usageChatParticipant.ts — @usage participant, logs source='participant'
  ui/statusBar.ts                     — StatusBarItem updated after each ingest batch
  ui/dashboardPanel.ts                — WebviewPanel host, postMessage aggregate data
  webview/dashboard.ts (+html/css)    — vanilla TS/JS, inline SVG charts, breakdown tables
```

## Storage schema

```sql
requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT, request_id TEXT,
  source TEXT CHECK(source IN ('passive','participant')),
  workspace_hash TEXT, workspace_path TEXT NULL,
  timestamp INTEGER,               -- original request time, epoch ms
  category TEXT,                   -- free text, tunable without migration
  language TEXT,
  model_id TEXT,
  agent_id TEXT NULL, agent_name TEXT NULL,
  prompt_text TEXT,
  response_text TEXT,
  attachments_json TEXT NULL,
  schema_version_seen INTEGER,
  created_at INTEGER,
  UNIQUE(session_id, request_id, source)
)

ingestion_state (
  file_path TEXT PRIMARY KEY,
  last_mtime_ms INTEGER, last_size_bytes INTEGER, last_request_count INTEGER,
  last_processed_at INTEGER, schema_version_seen INTEGER,
  parse_error_count INTEGER, last_error TEXT NULL
)
```

`UNIQUE(session_id, request_id, source)` + per-file cursors in `ingestion_state` make re-ingestion idempotent — only new/changed requests get parsed.

**Storage location: `context.globalStorageUri`**, not `context.storageUri`. Reasons: source data spans many workspaces plus global empty-window sessions (a workspace-scoped DB would fragment); `context.storageUri` is `undefined` with no folder open, which is exactly where empty-window sessions originate.

**sql.js persistence**: in-memory-first WASM SQLite — must explicitly `db.export()` → write bytes to disk, reload via `initSqlJs()` + `new SQL.Database(bytes)` on activation. Flush on debounced idle timer + forced flush in `deactivate()`. Accept: rows written between flushes can be lost on a crash — not solving with a WAL for MVP.

## Build milestones

1. Scaffold via `yo code`, confirm F5 → Extension Development Host works, initial commit.
2. Parser spike (no DB): parse one verified real file into `ParsedRequest[]`, log to Output channel. Confirms schema assumptions early.
3. Storage layer: sql.js + schema, `usageLogger.rescanHistory` backfills all discovered files, cross-check `SELECT COUNT(*)` against an independent tally.
4. Classifier + language detector as pure functions, sanity-checked against real prompts already on this machine.
5. Status bar wired to real counts.
6. Live watcher: chokidar on both roots, debounced incremental ingestion; verify by sending a live Copilot Chat message and watching the count update without restart.
7. Webview dashboard: message-passing skeleton, aggregate queries, inline SVG charts.
8. Chat participant path: `@usage` + `/stats`, `source='participant'`, verify passive watcher does not double-count it.
9. Polish: retention/purge command, defensive-parsing audit (feed it garbage, confirm no crash), verify `.wasm` lands in bundle, `vsce package` → install real `.vsix` in main VS Code app for final end-to-end check.

## Key risks (explicit trade-offs, not silently decided)

1. **MVP scopes to `workspaceStorage/chatSessions/*.json` only.** The `emptyWindowChatSessions/*.jsonl` patch-log format is structurally different and more work — ship as a fast-follow. Means chat usage in folder-less windows isn't captured until then.
2. **Passive/participant double-counting**: `@usage`'s own turns also land in the normal chatSessions files (different `agent.id`). `ingestor.ts` must explicitly skip entries whose `agent.id` matches the extension's own participant id — concrete implementation item, not just a note.
3. **Extension Dev Host profile ambiguity** — first thing to verify empirically: does `context.globalStorageUri` in F5 dev host resolve under the same `~/Library/Application Support/Code/User` holding real history, or an isolated profile? If isolated, real end-to-end testing needs the packaged `.vsix` sideloaded into the main app (milestone 9), not just F5.
4. **Format fragility**: `version: 3` on this VS Code build isn't guaranteed stable. Every parse entry point catches-and-skips per malformed request, logs `schema_version_seen` + error counts per file.
5. **Privacy**: full raw prompt/response text (potentially proprietary code, pasted secrets) stored unencrypted under `globalStorage`. README must call this out prominently; purge/retention ships near-MVP; confirm `globalStorage` isn't swept into Settings Sync by default.
6. **Remote windows (SSH/WSL/Codespaces)**: `context.globalStorageUri` resolves remote-side, may not match local chat activity. Detect `vscode.env.remoteName`, no-op gracefully. Local windows only for MVP.
7. **Classifier is rough by nature** — multi-intent prompts will misclassify. `category` stored as free text (not SQL enum) specifically so the keyword table can be retuned post-launch without a migration.

## Verification

- Milestone 2: parse against a real file already on this machine, confirm expected fields extracted.
- Milestone 3: independent count cross-check (script tally vs `SELECT COUNT(*)`) over all discovered session files.
- Milestone 6: send a real Copilot Chat message, confirm status bar increments within debounce window, no restart needed.
- Milestone 8: invoke `@usage /stats`, confirm one row with `source='participant'`, confirm passive watcher doesn't create a duplicate for the same underlying file change.
- Milestone 9 (final deliverable check): `vsce package`, install the resulting `.vsix` into the main VS Code app, confirm it activates, backfills real history, dashboard renders, and the sql.js `.wasm` asset is actually present in the bundle.

## Critical files
- `src/extension.ts`
- `src/parser/sessionParser.ts`
- `src/ingest/ingestor.ts`
- `src/storage/db.ts`
- `src/classify/classifier.ts`
