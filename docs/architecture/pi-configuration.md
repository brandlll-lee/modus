# PI Desktop Integration

Modus embeds PI 0.99.1 and uses `PI_CODING_AGENT_DIR`, or `~/.pi/agent` when unset.
PI's SettingsManager, ModelRuntime and DefaultResourceLoader own settings,
credentials, models, instruction files, skills, packages and extensions.
Project resources follow PI's trust decisions. Model preferences selected in
the desktop are saved through PI's settings API and are shared with the CLI.
Desktop appearance and layout preferences remain in the application profile.

## Runtime

Opening a conversation restores its SessionManager and SDK runtime. The initial
context and cumulative usage snapshot comes from `getSessionStats()`; subsequent
SDK events refresh it. Switching between chat and settings keeps that runtime.
Leaving a session releases an idle runtime; active work continues until it settles.
Session files remain in the desktop profile, preserving existing conversation IDs.

PI's built-in MCP, codemode and tool-search extensions retain their native
replacement semantics. An installed extension that replaces MCP owns its
connections and authentication. The GUI displays its `/mcp` report and exposes
commands registered by that same extension. It does not infer connection states
from message text. Extension notifications are transient desktop status messages.

Desktop tools use deferred exposure and PI's tool-search implementation for
discovery. PI's selected tools remain authoritative across turns. Plan-mode
permissions apply to both direct and nested tool execution.

## Upgrade Checks

Keep PI dependencies pinned together. For an upgrade, review official release
notes and exported API declarations, then run typecheck, tests and the desktop
build. Integration checks cover native settings and trust, extension replacement,
deferred tools, persisted context/cost/cache statistics and skill discovery.
Desktop checks cover cold session opening, streaming, model changes, compaction,
resource refresh, MCP commands and provider dialog keyboard/focus behavior.

Official references:
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/mcp.md
