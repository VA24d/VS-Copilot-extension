# Lloyds Banking Group — Copilot Usage Logger

Local-first logging and classification of your GitHub Copilot Chat usage. Full prompt/response detail never leaves your machine. An optional, off-by-default company-wide reporting feature can send **aggregate counts only** (never prompt/response text) to an internal endpoint — see below.

## What it does

- Watches VS Code's local Copilot Chat session files (`workspaceStorage/*/chatSessions/*.jsonl`, an append-only patch log — confirmed against real VS Code 1.130+ session files) and parses new requests as they happen.
- Classifies each request into a rough category: code-gen, debug/fix, explain, refactor, test, docs, git/terminal, search/navigate, or other.
- Detects the primary language involved (from attached files, or fenced code blocks in the response).
- Stores everything in a local SQLite database (`sql.js`, WASM) under the extension's global storage folder.
- Status bar item shows today's request count, or (via `usageLogger.statusBarDisplay: "remainingCredits"`) remaining cost-unit budget for today, or a private-mode indicator; click it to open a dashboard (by category, language, model, and day), which auto-refreshes and shows the machine's hostname and the Lloyds Banking Group logo.
- A `@usage` chat participant (`/stats`) gives a quick summary on demand, as a fully-controlled secondary capture path.

## ⚠️ Privacy note

This extension stores the **full text of your prompts and Copilot's responses**, unencrypted, in a local SQLite file under your VS Code global storage directory. This may include proprietary code or anything else you've pasted into chat.

- By default, nothing leaves your machine — there is no network code active unless you explicitly enable company-wide reporting (below).
- Use "Copilot Usage: Purge All Logged Data" to delete everything.
- Set `usageLogger.retentionDays` to automatically age out old requests.
- Turn on **private mode** (below) to pause logging entirely for a sensitive session.
- Use `usageLogger.excludedPathGlobs` to skip logging entirely for requests touching specific files/folders.
- Check whether your global storage folder is included in Settings Sync if that matters to you.

## Private mode & excluding sensitive code

- **Private mode** (`usageLogger.privateMode`, or run **"Copilot Usage: Toggle Private Mode"**): pauses all logging — nothing is written to the local database while it's on. The status bar shows a lock icon while active. Turning it back off automatically catches up on anything logged since (it does not retroactively recover what happened *during* private mode, by design).
- **Path exclusion** (`usageLogger.excludedPathGlobs`, e.g. `["**/secrets/**", "**/*.pem"]`): any request with an attached file matching one of these globs is skipped entirely — not logged at all, not even its metadata.

## Sensitive data-label redaction (local storage only — please read this)

`usageLogger.sensitiveLabelKeywords` (e.g. `["CONFIDENTIAL", "RESTRICTED"]`) lets you flag requests whose prompt/response text or attached file paths contain a data-classification keyword. Matching requests still have their **metadata** logged (category/language/model/timestamp, for usage stats), but the prompt and response **text is redacted before it's written to the local database**.

**This is a local-storage control only.** VS Code's Chat API does not give any extension a hook to intercept, block, or redact content before it is sent to the Copilot model — this extension only ever reads chat history *after* the fact from files VS Code has already written. Nothing built into this extension can stop proprietary/classified content from reaching the model in the first place. If that's the actual requirement, it has to be enforced with **GitHub Copilot's org-level Content Exclusion policy**, configured by a GitHub admin at the organization level (github.com), which operates independently of this extension.

## Company-wide reporting (opt-in, off by default)

For an org-wide rollout, each machine can periodically send an **aggregate-only** usage report to an internal endpoint you configure — counts grouped by category, language, model, and day, plus a random per-machine ID (not tied to your identity). **Raw prompt/response text and file paths are never included in this payload.**

To enable:

1. Set `usageLogger.enableCompanyWideReporting` to `true`.
2. Set `usageLogger.reportingEndpointUrl` to your internal HTTPS endpoint.
3. If the endpoint requires auth, run **"Copilot Usage: Set Reporting API Key"** — this stores the key in VS Code's encrypted secret storage, never in `settings.json`.
4. Optionally tune `usageLogger.reportingIntervalMinutes` (default 60).
5. Use **"Copilot Usage: Send Company-Wide Report Now"** to test immediately; check the "Copilot Usage Logger" output channel for the result.

The endpoint must be `https://` unless you explicitly set `usageLogger.allowInsecureHttp` (only for a genuinely trusted, isolated intranet). This extension does not ship or assume any specific backend — you (or your platform team) need an endpoint that accepts this JSON shape:

```json
{
  "schemaVersion": 1,
  "deviceId": "<random-uuid>",
  "generatedAt": "2026-07-23T22:00:00.000Z",
  "windowDays": 30,
  "totalRequests": 123,
  "byCategory": [{ "category": "code-gen", "count": 40 }],
  "byLanguage": [{ "language": "TypeScript", "count": 55 }],
  "byModel": [{ "modelId": "gpt-4.1", "count": 60 }],
  "byDay": [{ "day": "2026-07-23", "count": 12 }]
}
```

### MongoDB transport

Instead of HTTPS, you can send the same aggregate-only payload to a local/internal MongoDB collection:

1. Set `usageLogger.reportingTransport` to `"mongodb"`.
2. Set `usageLogger.mongoDatabase` and `usageLogger.mongoCollection`.
3. Run **"Copilot Usage: Set MongoDB Connection String"** (e.g. `mongodb://localhost:27017`) — stored in VS Code's encrypted secret storage, never in `settings.json`, since connection strings often embed credentials.
4. Use **"Copilot Usage: Send Company-Wide Report Now"** to test.

### Company-wide dashboard (Mongo transport only)

If you're using the MongoDB transport, **"Copilot Usage: Open Company-Wide Dashboard"** opens a read-only, org-wide view aggregated live across every machine's latest report in the shared collection — total requests, and breakdowns by category, language, model, and day, plus a per-device table. It reads directly from MongoDB each time it's opened/refreshed; it never writes anything.

Setup is the same prerequisites as the MongoDB transport above — this panel just reads what that transport writes:

1. `usageLogger.reportingTransport` set to `"mongodb"`, with `usageLogger.mongoDatabase` and `usageLogger.mongoCollection` set.
2. A connection string saved via **"Copilot Usage: Set MongoDB Connection String"**.
3. At least one device having sent a report (manually via **"Copilot Usage: Send Company-Wide Report Now"**, or on its normal `usageLogger.reportingIntervalMinutes` schedule) so there's a document to read.

If any of these are missing, the panel shows an inline error explaining what to set up instead of a blank dashboard. Since every device sends periodic *cumulative* snapshots (not deltas), the aggregate is computed from only the most recent document per `deviceId` — summing every stored document would overcount.

## Compliance / audit export

**"Copilot Usage: Export Audit CSV"** writes a metadata-only CSV (timestamp, category, language, model, agent, source, workspace hash) — deliberately excluding prompt/response text, so the export is safe to hand to an auditor without a separate redaction pass.

## Dashboard analytics

- **Language detection**: primary signal is the file paths actually touched by agent-mode tool calls (edits applied, files shown in a code block), tallied by frequency across every file involved in a request — not just the first match. Falls back to fenced code-block language tags in the response text. Requests with no file touched and no code fence (pure Q&A, planning, terminal-only turns) legitimately show as "unknown" — that's expected, not a bug.
- **Copilot cost units**: per-request `copilotCredits` value that VS Code itself reports, shown as a running total, a this-month total, and a daily trend. This is a *relative* cost signal — it is **not confirmed to be identical to GitHub's official Copilot Business/Enterprise premium-request billing meter**, so treat it as a useful proxy, not an invoice. Set `usageLogger.monthlyCreditLimit` to show usage against your org's allowance.
- **Multi-device credits sync**: this extension only sees Copilot activity in the local VS Code windows it's installed in — a Business/Enterprise seat's quota is shared across every device the account uses, so credits spent elsewhere are invisible here and the daily-budget figures will understate real usage. Run "Copilot Usage: Sync Actual Credits Used This Month" (or the "Sync credits used on other devices" button/link on the dashboard and status bar hover) and enter the "used" total shown in the native Copilot Business/Enterprise flyout to reconcile — the gap is stored for the current calendar month and folded into the monthly/daily-budget math. Re-sync periodically since it's a point-in-time correction, not a live feed.
- **Cost units by model**: which models actually consume your cost units (sum of `copilotCredits` per model), for spotting an expensive model doing routine work a cheaper one could handle.
- **Burn-rate forecast**: with a `monthlyCreditLimit` set, projects your month-end spend at the current pace and flags whether you're on track to stay under the limit. The status bar item also turns amber once today's spend meets/exceeds today's even budget share.
- **Status bar display**: set `usageLogger.statusBarDisplay` to `"remainingCredits"` to show remaining cost-unit budget for today in the status bar instead of the request count (falls back to the request count if no `monthlyCreditLimit` is set).
- **Trend window**: the "requests per day" and cost-unit trend charts have a selector (7 / 30 / 90 / 180 days) instead of a fixed 30-day window.
- **Model fit (heuristic)**: flags requests where a high-cost model was used for a task category that's typically low-complexity, or a lightweight model for a typically high-complexity category, based on matching the model name against a rough tier table and the classified category against a rough complexity table. This is a pattern worth a glance for cost optimization — **it is not a judgment on any individual request** and both tables are approximate.
- **Estimated time saved**: an aggregate estimate, computed from stored request counts per category × a configurable minutes-saved-per-request assumption (`usageLogger.timeSavingsMinutesPerCategory`, defaults loosely informed by published AI pair-programming research such as GitHub's 2022 study reporting ~55% faster task completion). **This is a directional estimate, not a measurement** — nothing in this extension can observe how long a task would have taken without Copilot.

## Confluence knowledge tools (chat)

The extension contributes two language-model tools so Copilot chat (agent mode, or via `#confluence` / `#confluencePage`) can ground its answers in your organization's Confluence wiki — internal standards, runbooks, architecture decisions, onboarding docs, and policies that aren't in the codebase:

- `search_confluence` — free-text search of your Confluence Cloud site; returns matching pages (title, id, url, excerpt).
- `get_confluence_page` — fetches the full (HTML-stripped, length-capped) text of a page by id.

Setup:

1. Set `usageLogger.confluenceBaseUrl` to your Confluence Cloud base URL **including** the `/wiki` suffix (e.g. `https://yourcompany.atlassian.net/wiki`).
2. Set `usageLogger.confluenceEmail` (or `usageLogger.atlassianEmail`) to your Atlassian account email.
3. Create an API token at <https://id.atlassian.com/manage/api-tokens>, then run **"Copilot Usage: Set Confluence API Token"** to store it securely (kept in VS Code secret storage, never in `settings.json`).
4. Optionally run **"Copilot Usage: Test Confluence Connection"** to verify.

Security/behavior notes: requests use HTTP Basic auth over HTTPS only (http:// is refused so credentials are never sent in the clear); the token is stored in secret storage and never logged; the tools are **read-only**; results are size-capped; and the tools honor your Confluence permissions (you only ever see pages your account can already read).

## Jira knowledge tools (chat)

Two more tools ground answers in your organization's Jira issues (tickets, acceptance criteria, status) — via `#jira` / `#jiraIssue` or agent mode:

- `search_jira` — free-text issue search (most-recently-updated first); returns key, summary, type, status, assignee, url.
- `get_jira_issue` — full details + HTML-stripped description of one issue by key (e.g. `PROJ-123`).

Setup: set `usageLogger.jiraBaseUrl` to your Jira Cloud site **without** a path suffix (e.g. `https://yourcompany.atlassian.net`). Jira reuses the **same** Atlassian email + API token as Confluence — one token authenticates both. Optionally run **"Copilot Usage: Test Jira Connection"**. Same security posture as the Confluence tools (HTTPS-only, read-only, permission-honoring).

## GitHub knowledge tools (chat)

Search your org's GitHub beyond the open workspace — via `#github` or agent mode:

- `search_github` — search `issues` (and PRs), `code`, or `repositories`. Returns title, detail, url.

Setup: run **"Copilot Usage: Set GitHub Token"** to store a personal access token (classic or fine-grained; code search requires an authenticated token) in secret storage. Optionally set `usageLogger.githubOrg` to scope every search to one organization. Read-only; honors the token's own permissions; token never logged.

## Getting started

Run **"Copilot Usage: Setup"** for a guided menu of everything above, or open the **Copilot Usage Logger — Getting Started** walkthrough (Help → Get Started).

## Known limitations (MVP)

- Remote windows (SSH/WSL/Codespaces) are not supported yet — the extension no-ops in remote windows.
- Folder-less ("empty window") chat sessions (`globalStorage/emptyWindowChatSessions/*.jsonl`) are not parsed yet — only workspace-scoped sessions.
- The undocumented chat session file format may change between VS Code versions without notice; parsing is defensive (per-line/per-patch error isolation) but may occasionally miss data on a schema shift.
- Classification is keyword-based and rough — multi-intent prompts may be misclassified.
- The dashboard shows the machine's hostname as a proxy for "who" (corporate hostnames often map to a specific employee) — this is a deliberate, visible-only-to-you local UI convenience, not something included in the company-wide report payload (which still uses only the anonymous per-machine `deviceId`).

## Commands

- **Copilot Usage: Open Dashboard**
- **Copilot Usage: Rescan Chat History** — manual backfill
- **Copilot Usage: Purge All Logged Data**
- **Copilot Usage: Toggle Private Mode**
- **Copilot Usage: Export Audit CSV**
- **Copilot Usage: Send Company-Wide Report Now** — manual/test trigger for the opt-in reporting feature
- **Copilot Usage: Set Reporting API Key** / **Clear Reporting API Key**
- **Copilot Usage: Set MongoDB Connection String** / **Clear MongoDB Connection String**
- **Copilot Usage: Open Company-Wide Dashboard** — org-wide, read-only aggregate view (requires MongoDB transport, see above)

## Settings

- `usageLogger.enablePassiveCapture` (default `true`)
- `usageLogger.retentionDays` (default `0` = unlimited)
- `usageLogger.privateMode` (default `false`)
- `usageLogger.excludedPathGlobs` (default `[]`)
- `usageLogger.sensitiveLabelKeywords` (default `[]`)
- `usageLogger.enableCompanyWideReporting` (default `false`)
- `usageLogger.reportingTransport` (default `"http"`, or `"mongodb"`)
- `usageLogger.reportingEndpointUrl` (default `""`)
- `usageLogger.mongoDatabase` / `usageLogger.mongoCollection` (default `""`)
- `usageLogger.reportingIntervalMinutes` (default `60`)
- `usageLogger.allowInsecureHttp` (default `false`)
- `usageLogger.monthlyCreditLimit` (default `0` = no limit shown)
- `usageLogger.timeSavingsMinutesPerCategory` (default `{}` = use built-in heuristic defaults)
