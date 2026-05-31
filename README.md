<p align="center">
  <h1 align="center">Modus</h1>
  <p align="center">
    The local-first Agent Window for open-source coding agents.
  </p>
</p>

<p align="center">
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0-blue"></a>
  <img alt="Status" src="https://img.shields.io/badge/status-v0.1.0%20MVP-black">
  <img alt="Desktop" src="https://img.shields.io/badge/desktop-Electron-47848f">
  <img alt="Runtime" src="https://img.shields.io/badge/runtime-pi-7c3aed">
  <img alt="Local first" src="https://img.shields.io/badge/local--first-yes-16a34a">
</p>

<p align="center">
  English | <a href="./README.zh-CN.md">简体中文</a>
</p>

---

Modus is an open-source, local-first alternative to the modern Cursor Agent Window.

It is not a VS Code fork. It is a focused desktop app for running coding agents against
your local repositories, with real terminal control, Git diffs, worktrees, permission
gates, and local metadata storage.

Bring your own models through `pi`, keep your code on your machine, and review every
change before it lands.

> Modus V0.1.0 is an engineering MVP. The desktop foundation is working; the product is
> still moving fast.

## Why Modus

Most coding agents either live inside a closed IDE, a terminal-only interface, or a
cloud workflow. Modus is built around a different bet:

- The agent UI should be open source.
- The default execution path should be local-first.
- Terminal, diff, permissions, and worktrees should be first-class product surfaces.
- The runtime should be swappable instead of locked to one vendor.
- The desktop app should feel like an agent cockpit, not a generic editor fork.

## Current Features

| Area | Status | What Works in V0.1.0 |
| --- | --- | --- |
| Desktop app | MVP | Electron desktop shell, secure preload bridge, React Agent Window UI |
| Local workspaces | MVP | Open folders, remember recent workspaces, detect Git repositories |
| Agent runtime | MVP | `pi --mode rpc` adapter, JSONL parsing, prompt/abort/event mapping |
| Terminal | MVP | Real PTY sessions through the Rust `modus-pty-host` sidecar and `xterm.js` |
| Diff review | MVP | Git changed-file scanner and Monaco diff viewer |
| Permissions | MVP | Permission decision model, local persistence, IPC surface |
| Worktrees | MVP | Git worktree list/create/delete IPC |
| Packaging | MVP | Windows NSIS installer smoke test passes |

## Screenshots

The first public screenshots will land with the next UI polish pass.

For now, V0.1.0 contains the first Agent Window shell:

- workspace/session sidebar
- agent timeline and composer
- security state panel
- Git diff review panel
- real terminal panel

## Architecture

```text
Modus Desktop
├─ Electron Main
│  ├─ secure window lifecycle
│  ├─ typed IPC handlers
│  ├─ workspace, Git, permission, diff, and worktree services
│  ├─ pi RPC adapter
│  └─ Rust PTY sidecar bridge
│
├─ Preload
│  └─ window.modus typed API
│
├─ Renderer
│  ├─ React Agent Window
│  ├─ xterm.js terminal UI
│  └─ Monaco diff viewer
│
└─ Rust Sidecar
   └─ modus-pty-host
      └─ portable-pty over PTY / ConPTY / openpty
```

The key design choice is that Modus stays TypeScript-first at the product layer while
moving low-level terminal control into a small Rust sidecar. This avoids Electron native
addon rebuild problems and gives Modus a cleaner path toward terminal persistence,
agent handoff, and crash isolation.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Desktop runtime | Electron 42 |
| Build | electron-vite + Vite |
| UI | React 19 + Tailwind CSS v4 |
| Editor and diff | Monaco Editor |
| Terminal UI | xterm.js |
| PTY host | Rust + portable-pty |
| Local data | SQLite via Node `node:sqlite` |
| Agent runtime | `pi` |
| Package manager | npm workspaces |
| Quality | TypeScript strict + Biome + Vitest |
| Packaging | electron-builder |

## Quick Start

### Prerequisites

- Node.js `>=22.19.0`
- npm
- Rust toolchain with Cargo
- Git
- `pi` available on your PATH for agent runtime experiments

### Install

```bash
npm install
```

### Run the Desktop App

```bash
npm run dev
```

### Build

```bash
npm --workspace @modus/desktop run build
```

This builds both the Electron app and the Rust `modus-pty-host` sidecar.

### Package on Windows

```bash
npm --workspace @modus/desktop run package:win -- --publish never
```

The Windows unpacked app includes:

```text
resources/bin/modus-pty-host.exe
```

## Repository Layout

```text
modus/
├─ apps/
│  ├─ desktop/              # Electron desktop app
│  └─ web/                  # Reserved for the future website
├─ crates/
│  └─ pty-host/             # Rust PTY sidecar
├─ packages/
│  ├─ agent-protocol/       # Shared agent event protocol
│  ├─ config/               # Shared config placeholder
│  ├─ core/                 # Shared domain types
│  └─ ui/                   # Shared UI/design exports
├─ docs/
│  └─ architecture/         # Architecture notes
└─ MODUS_V0.1.0_EXECUTION_PLAN.md
```

## What V0.1.0 Is

V0.1.0 is the foundation:

- a working desktop shell
- a local workspace model
- a real terminal architecture
- a Git diff surface
- a permission model
- a worktree model
- a `pi` runtime adapter
- a Windows packaging smoke path

## What V0.1.0 Is Not Yet

Modus is not yet a complete Cursor replacement.

Still in progress:

- polished production UI
- full `@` context picker
- complete permission prompts for every dangerous action
- mature `pi` end-to-end workflows
- terminal persistence and replay
- multi-agent orchestration UI
- macOS/Linux packaging smoke
- signing, icons, auto-update, release channels

## Roadmap

### V0.2

- real context picker for files, folders, diffs, terminal output, and sessions
- stronger permission prompts and audit trail
- terminal buffering and backpressure
- better diff review actions
- first usable `pi` task loop from prompt to patch

### V0.3

- parallel local agents
- worktree-backed task isolation
- session replay and branching
- richer tool call cards
- agent review workflow

### Later

- cloud handoff as an optional feature
- MCP server management
- semantic/codegraph context
- official website and docs
- cross-platform signed releases

## Development Commands

```bash
npm run dev
npm run check
npm run format
npm --workspace @modus/desktop run build
npm --workspace @modus/desktop run package:win -- --publish never
cargo check -p modus-pty-host
```

## Design Principles

- Local-first by default.
- Open source by default.
- The renderer is unprivileged.
- Dangerous actions go through permission gates.
- Agent work should be reviewable through diffs.
- Terminal control should be real PTY control, not a fake text box.
- Low-level system boundaries belong in small isolated hosts.

## Contributing

Modus is early. The best contributions right now are:

- bug reports with logs and repro steps
- Windows/macOS/Linux packaging feedback
- UI/UX critique for the Agent Window
- `pi` runtime integration fixes
- terminal sidecar improvements
- documentation and examples

Before opening large PRs, please start with an issue or design note so the architecture
stays coherent.

## License

Modus is open source under the AGPL-3.0 license.

