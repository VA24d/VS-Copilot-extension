# Search SharePoint & Microsoft Teams

Ground chat answers in your org's SharePoint documents and Teams conversations, via Microsoft Graph.

1. Get a Microsoft Graph access token, e.g. `az account get-access-token --resource https://graph.microsoft.com --query accessToken -o tsv` (or however your org issues Graph tokens). Needs `Sites.Read.All`/`Files.Read.All` for SharePoint, `Chat.Read`/`ChannelMessage.Read.All` for Teams.
2. Run **Copilot Usage: Set Microsoft Graph Token** to store it securely (secret storage, never `settings.json`).
3. Run **Copilot Usage: Test Microsoft Graph Connection** to confirm it works.

This adds the `#sharepoint` and `#teams` chat tools. Both are **read-only** and honor the token's own permissions.

**Note:** unlike the GitHub/Confluence/Jira tokens, Graph access tokens are short-lived (typically ~1 hour) — you'll need to re-run "Set Microsoft Graph Token" with a fresh one periodically.
