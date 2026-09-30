# PI Configuration

Modus embeds PI 0.99.1. Its user agent directory is `~/.modus/agent`.
The inherited PI directory is the original `PI_CODING_AGENT_DIR`, or
`~/.pi/agent` when that variable is unset.

## Sources

Settings and MCP definitions have this precedence, from lowest to highest:

1. PI user directory.
2. Trusted workspace `.pi` directory.
3. Modus user directory.
4. Trusted workspace `.modus` directory.

PI handles settings merge semantics, resource parsing, package resolution,
resource selectors and collision diagnostics. Relative resource paths retain
their declaring configuration directory. Refresh reloads external file changes.
Project settings and executable resources require project trust.

`models.json` and `auth.json` are user-scoped. A Modus provider definition replaces
the entire inherited definition with the same provider ID. Provider overrides
use their own credentials; inherited stored credentials are not routed through
overridden provider definitions. Model metadata and availability come from PI.
Native `enabledModels` patterns scope model cycling, not the displayed catalog.

PI discovers instruction files, including `AGENTS.md`, `CLAUDE.md`, and native
system-prompt files. Shared instruction paths are included once.

## Credentials

Inherited PI credentials are read-only. Modus never copies inherited OAuth
refresh tokens or updates the PI credential file. Refresh expired inherited
credentials through PI CLI, then refresh Modus.

Modus-owned credentials use PI's `CredentialStore` contract. PI performs OAuth;
the store persists complete credentials under a filesystem lock shared with PI.
API-key values support native environment references and whole-value commands.
Credential listing does not execute commands.

To authenticate directly into the Modus directory, start PI CLI with
`PI_CODING_AGENT_DIR` set to `~/.modus/agent` in that terminal session.

## Desktop Views

Provider settings display native catalog metadata and credential sources.
MCP displays the selected session's native report and existing configuration
locations. Skills displays the selected loader's skills and diagnostics.
Resource refresh requires idle sessions. Source navigation opens an existing
folder and does not create configuration files.

The current conversation's model and thinking level come from its PI session.
Unavailable explicit selections fail instead of switching to another model.

## Migration

At startup, applicable migration writes a SQLite backup and configuration copies
under the application profile's `configuration-backup-*` directory. Its report is
`configuration-migration.json` in the same profile.

Existing `~/.modus/mcp.json` and `~/.modus/skills` are copied into the agent
directory only when their destinations are absent. Conflicting destinations are
preserved and recorded. Original files remain in place. Historical profile
credentials and model definitions are archived, not activated. Retired model
configuration tables and the database default-model setting are removed after
backup; conversation tables and native session files are preserved.
