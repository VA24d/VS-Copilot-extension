# Copilot Usage Logger

Local-only logging and classification of your GitHub Copilot Chat usage. Everything stays on your machine — nothing is uploaded anywhere.

## What it does

- Watches VS Code's local Copilot Chat session files (`workspaceStorage/*/chatSessions/*.json`) and parses new requests as they happen.
- Classifies each request into a rough category: code-gen, debug/fix, explain, refactor, test, docs, git/terminal, search/navigate, or other.
- Detects the primary language involved (from attached files, or fenced code blocks in the response).
- Stores everything in a local SQLite database (`sql.js`, WASM) under the extension's global storage folder.
- Status bar item shows today's request count; click it to open a dashboard (by category, language, model, and day).
- A `@usage` chat participant (`/stats`) gives a quick summary on demand, as a fully-controlled secondary capture path.

## ⚠️ Privacy note

This extension stores the **full text of your prompts and Copilot's responses**, unencrypted, in a local SQLite file under your VS Code global storage directory. This may include proprietary code or anything else you've pasted into chat.

- Nothing ever leaves your machine — there is no network code in this extension.
- Use "Copilot Usage: Purge All Logged Data" to delete everything.
- Set `usageLogger.retentionDays` to automatically age out old requests.
- Check whether your global storage folder is included in Settings Sync if that matters to you.

## Known limitations (MVP)

- Only captures chat sessions tied to an open workspace/folder (`workspaceStorage`). Folder-less ("empty window") chat sessions use a different, append-only log format and aren't parsed yet.
- Remote windows (SSH/WSL/Codespaces) are not supported yet — the extension no-ops in remote windows.
- The undocumented chat session file format may change between VS Code versions without notice; parsing is defensive but may occasionally miss data on a schema shift.
- Classification is keyword-based and rough — multi-intent prompts may be misclassified.

## Commands

- **Copilot Usage: Open Dashboard**
- **Copilot Usage: Rescan Chat History** — manual backfill
- **Copilot Usage: Purge All Logged Data**

## Settings

- `usageLogger.enablePassiveCapture` (default `true`)
- `usageLogger.retentionDays` (default `0` = unlimited)
