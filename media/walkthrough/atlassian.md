# Ground answers in Confluence & Jira

Two Atlassian Cloud products, one API token.

1. Set `usageLogger.confluenceBaseUrl` to your wiki (e.g. `https://yourcompany.atlassian.net/wiki`) — **include** `/wiki`.
2. Set `usageLogger.jiraBaseUrl` to your Jira site (e.g. `https://yourcompany.atlassian.net`) — **no** path suffix.
3. Set `usageLogger.atlassianEmail` (or `usageLogger.confluenceEmail`) to your Atlassian account email.
4. Create an API token at <https://id.atlassian.com/manage/api-tokens>, then run **Copilot Usage: Set Confluence API Token** — the same token works for Jira too.

This adds the `#confluence`, `#confluencePage`, `#jira`, and `#jiraIssue` chat tools. They are **read-only** and honor your existing permissions.
