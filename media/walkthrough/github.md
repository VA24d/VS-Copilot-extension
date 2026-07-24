# Search GitHub org-wide

Let chat look beyond the open workspace — into your org's issues, PRs, code, and repositories.

1. Create a GitHub personal access token (classic or fine-grained) with read access to the repos you care about. Code search requires an authenticated token.
2. Run **Copilot Usage: Set GitHub Token** to store it securely (secret storage, never `settings.json`).
3. Optionally set `usageLogger.githubOrg` to scope every search to one organization.

This adds the `#github` chat tool. It is **read-only** and honors the token's own permissions.
