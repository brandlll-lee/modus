<div align="center">
  <h1>Modus</h1>
  <p><b>The open-source, local-first alternative to the Cursor 3.0 Agent Window.</b></p>
</div>

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

<p align="center">
  <a href="https://github.com/brandlll-lee/modus/releases/download/readme-demo-assets/Modu001.mp4">
    <img alt="Modus demo" src="./docs/media/modus-demo.gif" width="100%">
  </a>
</p>

<p align="center">
  Run coding agents against your own repositories. Bring your own models through <code>pi</code>,
  keep every line of code on your machine, and review every change before it lands.
</p>

---

Modus is an open-source coding agent cockpit. It is **not a VS Code fork** — it is a focused
desktop app built around the workflow that actually matters when an agent edits your code:
**real terminal control, Git diff review, worktree isolation, and permission gates**, all
backed by local metadata storage.

**Your code stays on your machine. Your runtime is swappable. The UI is open source.**

> Modus V0.1.0 is an engineering MVP. The desktop foundation is working end to end; the
> product is moving fast toward a full Cursor-class Agent Window.

## Why Modus

Most coding agents live inside a closed IDE, a terminal-only interface, or a cloud workflow.
Modus is built around a different bet:

- The agent UI should be **open source**.
- The default execution path should be **local-first**.
- Terminal, diff, permissions, and worktrees should be **first-class product surfaces**.
- The runtime should be **swappable**, not locked to one vendor.
- The desktop app should feel like an **agent cockpit**, not a generic editor fork.

## Features

| Feature | What works in V0.1.0 |
| --- | --- |
| **Agent Window** | Electron desktop shell with a secure preload bridge and a React Agent Window UI |
| **Local Workspaces** | Open folders, remember recent workspaces, auto-detect Git repositories |
| **Bring Your Own Model** | `pi --mode rpc` adapter with JSONL parsing and prompt / abort / event mapping |
| **Real Terminal** | True PTY sessions through the Rust `modus-pty-host` sidecar and `xterm.js` |
| **Diff Review** | Git changed-file scanner with a Monaco-powered diff viewer |
| **Permission Gates** | Permission decision model, local persistence, and a typed IPC surface |
| **Worktree Isolation** | Git worktree list / create / delete over IPC |
| **Local-first Storage** | Workspace and session metadata stored locally via SQLite |
| **Windows Packaging** | NSIS installer that passes a packaging smoke test |

## How We Compare

| | Modus | Cursor | GitHub Copilot | Continue |
|---|:---:|:---:|:---:|:---:|
| Open source | ✅ | ❌ | ❌ | ✅ |
| Local-first by default | ✅ | ❌ | ❌ | ⚠️ |
| Standalone app (not a VS Code fork/extension) | ✅ | ⚠️ fork | ❌ | ❌ |
| Real PTY terminal control | ✅ | ✅ | ❌ | ❌ |
| Built-in Git diff review | ✅ | ✅ | ⚠️ | ⚠️ |
| Permission gates for dangerous actions | ✅ | ⚠️ | ❌ | ❌ |
| Git worktree isolation | ✅ | ❌ | ❌ | ❌ |
| Swappable agent runtime | ✅ | ❌ | ❌ | ✅ |
| Your code stays on your machine | ✅ | ⚠️ | ❌ | ✅ |

> ⚠️ = partial, vendor-dependent, or opt-in. Modus is early — this table is where we are
> aiming, and most rows already work in V0.1.0.

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

The key design choice: Modus stays **TypeScript-first** at the product layer while moving
low-level terminal control into a **small Rust sidecar**. This avoids Electron native addon
rebuild problems and gives Modus a cleaner path toward terminal persistence, agent handoff,
and crash isolation.

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

### Install and run

```bash
npm install
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

## Roadmap

### V0.2

- Real context picker for files, folders, diffs, terminal output, and sessions
- Stronger permission prompts and an audit trail
- Terminal buffering and backpressure
- Better diff review actions
- First usable `pi` task loop from prompt to patch

### V0.3

- Parallel local agents
- Worktree-backed task isolation
- Session replay and branching
- Richer tool call cards
- Agent review workflow

### Later

- Cloud handoff as an optional feature
- MCP server management
- Semantic / codegraph context
- Official website and docs
- Cross-platform signed releases

## What V0.1.0 Is Not Yet

Modus is not yet a complete Cursor replacement. Still in progress:

- Polished production UI
- Full `@` context picker
- Complete permission prompts for every dangerous action
- Mature `pi` end-to-end workflows
- Terminal persistence and replay
- Multi-agent orchestration UI
- macOS / Linux packaging smoke
- Signing, icons, auto-update, release channels

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

- Bug reports with logs and repro steps
- Windows / macOS / Linux packaging feedback
- UI/UX critique for the Agent Window
- `pi` runtime integration fixes
- Terminal sidecar improvements
- Documentation and examples

Before opening large PRs, please start with an issue or design note so the architecture
stays coherent.

## License

Modus is open source under the [AGPL-3.0](./LICENSE) license.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=brandlll-lee/modus&type=Date)](https://www.star-history.com/#brandlll-lee/modus&Date)
