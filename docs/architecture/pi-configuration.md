# PI Desktop Integration

Modus embeds PI 1.0.0. PI owns settings, credentials, models, instruction files, skills, packages, extensions, tools, and Agent execution. The GUI displays PI events and adapts extension dialogs.

## Configuration

PI_CODING_AGENT_DIR selects the global directory. Its default is ~/.pi/agent. PI resolves project trust, including extension decisions and temporary trust. Desktop appearance, layout, pins, and archive preferences stay in the application profile.

## Sessions

SessionManager files are the persistent conversation source. Session paths follow PI_CODING_AGENT_SESSION_DIR and native sessionDir settings. A desktop JSON file stores project shortcuts, pins, and archive preferences. It contains no conversation messages. Startup discovers native sessions for registered workspaces.

Opening a conversation restores the native session and reads getSessionStats(). SDK events update context, cost, cache, retry, and running state. Missing or invalid files produce an error. Model fallback warnings allow native startup to continue. Editing a message navigates the native session tree.

Image thumbnails, selected file paths, and display message IDs use native custom entries. These entries hold GUI metadata. PI excludes them from model context. A memory cache holds live GUI events while a runtime is attached.

A one-time importer archives the application database before moving existing PI files to their native directory. It preserves desktop preferences and image metadata. The application then removes the active database. Native session IDs identify conversations.

## Extensions

Builtin MCP, codemode, and tool-search extensions use PI replacement and activation rules. An installed extension owns its tools, connections, and authentication. The GUI displays the MCP command report and invokes commands registered by the active extension.

## Upgrade Checks

Pin PI dependencies together. Check official release notes and installed API declarations before upgrading. Verify settings, trust, extension replacement, native history, image results, statistics, retries, cancellation, compaction, and model changes.

The trust adapter calls the resolver shipped in the pinned PI package. Check that resolver entry point during upgrades.

Official references:

- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session-format.md
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md
