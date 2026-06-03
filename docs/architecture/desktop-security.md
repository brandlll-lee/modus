# Desktop Security Baseline

Modus treats the desktop UI as a guest, not as the owner of the machine.

The renderer shows the app, but it does not get direct Node access. Anything that touches the
file system, Git, terminals, models, permissions, or local storage goes through the preload bridge
and then through Electron main-process handlers.

## Current Guardrails

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- typed `window.modus` preload API
- centralized IPC channel names in `apps/desktop/src/main/ipc/channels.ts`
- sender validation in main IPC registration
- local SQLite persistence for permission decisions and audit data
- PI SDK permission extension that blocks dangerous tool calls before execution

## Trust Boundary

```text
Renderer
  No direct Node access.
  Calls window.modus only.

Preload
  Exposes a small typed API through contextBridge.

Main process
  Owns workspace, Git, terminal, docs, model, permission, and agent services.

Rust sidecar
  Owns PTY spawning and terminal IO.
```

## Dangerous Agent Actions

The PI runtime is loaded with `createModusPermissionExtension`. The extension watches PI tool-call
events and blocks high-risk calls before they run. The decision is recorded locally and emitted to
the renderer as an agent event.

This gives the UI a path to show permission prompts and gives the database a path to keep an audit
trail. The user-facing approval flow is still early, but the guardrail exists in the runtime path.

## What Still Needs Hardening

- richer user-facing permission prompts
- a clearer permission history screen
- more granular policies for different tool/action types
- stronger packaging and signing defaults
- release-channel security checks before public distribution
