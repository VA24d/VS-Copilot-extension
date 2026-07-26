# Route blockers to the right person

Not every blocker is a code problem. When someone needs **access, a permission, an environment fix, a tool, or just "who do I ask?"**, the `#findHelp` chat tool points them at the sanctioned owner — a contact, a Teams chat, an intranet page, or a ServiceNow catalogue item — instead of guessing or asking around.

It's **local and read-only**: it matches the described blocker against a curated directory you control. No network, no credentials.

**Make it yours:**
1. Run **Copilot Usage: Open Help Directory** to start from the bundled sample.
2. Replace the placeholder contacts and links with your real owners.
3. Point `usageLogger.blockerDirectoryPath` at your copy (commit it in-repo so the whole team shares it), or paste entries into the `usageLogger.blockerDirectory` setting.

Then in chat: _"I can't reach the GCP payments project — who do I ask?"_ → `#findHelp` returns the owning team, their Teams channel, and the access-request link.
