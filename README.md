<div align="center">
  <h1>Modus</h1>
  <p><b>A local desktop cockpit for coding agents.</b></p>
</div>

<p align="center">
  <img alt="Status" src="https://img.shields.io/badge/status-active%20desktop%20prototype-black">
  <img alt="Desktop" src="https://img.shields.io/badge/desktop-Electron-47848f">
  <img alt="Runtime" src="https://img.shields.io/badge/runtime-PI%20SDK-7c3aed">
  <img alt="Local first" src="https://img.shields.io/badge/local--first-yes-16a34a">
</p>

<p align="center">
  English | <a href="./README.zh-CN.md">Simplified Chinese</a>
</p>

<p align="center">
  <a href="https://github.com/brandlll-lee/modus/releases/download/readme-demo-assets/Modu001.mp4">
    <img alt="Modus demo" src="./docs/media/modus-demo.gif" width="100%">
  </a>
</p>

Imagine sitting down with a very capable coding helper.

It can read your project. It can open a terminal. It can look at Git changes. It can remember
the conversation. It can switch models. But instead of floating somewhere far away in a cloud
tab, it sits beside your code like a small workbench lamp: close, local, visible, and reviewable.

That is Modus.

Modus is a desktop app for working with AI coding agents inside your own repositories. It is
not a full IDE and it is not a VS Code fork. It is a focused agent window: chat in the middle,
projects on the left, Git and terminal tools on the right, and a safety layer between the agent
and dangerous actions.

## What Modus Does Today

The current implementation already has the bones of a real local agent cockpit:

- **Desktop shell**: an Electron app with a custom menu bar, left sidebar, chat area, and right
  inspector panel.
- **Workspaces**: open a local folder, remember recent projects, and detect whether the folder is
  a Git repository.
- **Agent sessions**: create a session, send prompts, stream agent events, store chat history
  locally, and reopen previous sessions from the sidebar.
- **Model selection**: list models from the PI model registry, choose a default model, set a model
  per session, and cycle models from the keyboard.
- **Context with `@`**: attach files, folders, terminal output, Git diffs, or indexed Markdown docs
  to a prompt.
- **Git review**: list changed files, preview diffs, count added and removed lines, and revert a
  file through the app.
- **Real terminal**: create PTY-backed terminal sessions through a small Rust sidecar and render
  them with xterm.js.
- **Worktrees**: list, create, and remove Git worktrees for isolated agent tasks.
- **Security surface**: run the renderer without Node privileges, expose a typed preload API, check
  IPC senders, and block dangerous PI tool calls before they execute.
- **Local storage**: persist workspaces, sessions, agent events, permissions, terminal output, and
  Markdown doc chunks in a local SQLite database.

## A Tiny Tour

Open Modus and the left side feels like a project shelf. Pick a workspace, or open a new folder.
Under each project, your sessions sit like little notebooks with their last active time.

The middle is where you talk to the agent. Type a request, add `@README.md` or `@git diff`, choose
the model you want, and send. User messages appear as simple bubbles. Agent thoughts and tool work
stream into the timeline without hiding what happened.

The right panel is the workbench drawer. One tab shows Git changes. One tab is a real terminal.
One tab manages worktrees. One tab shows the desktop security state. The idea is simple: when the
agent touches your project, the proof should be right next to the conversation.

## Quick Start

### Requirements

- Node.js `>=22.19.0`
- npm
- Rust with Cargo
- Git
- PI model credentials/configuration available to `@earendil-works/pi-coding-agent`

### Install

```bash
npm install
```

### Run The Desktop App

```bash
npm run dev
```

Then:

1. Click **Open workspace**.
2. Choose a local project folder.
3. Start a new chat.
4. Pick a model from the composer.
5. Type a prompt, or add context with `@`.
6. Check the right panel for Git changes, terminal sessions, worktrees, and security state.

### Build

```bash
npm --workspace @modus/desktop run build
```

This builds the Electron app and the Rust `modus-pty-host` sidecar.

### Package

```bash
npm --workspace @modus/desktop run package:win -- --publish never
```

The packaging config includes the Rust terminal sidecar as an unpacked binary resource.

## Project Layout

```text
modus/
├─ apps/
│  ├─ desktop/              # Electron desktop app
│  └─ web/                  # Future website placeholder
├─ crates/
│  └─ pty-host/             # Rust PTY sidecar used by the terminal panel
├─ docs/
│  └─ architecture/         # Architecture notes
├─ packages/                # Shared package placeholders
├─ MODUS_V0.1.0_EXECUTION_PLAN.md
└─ MODUS_V0.1.1_EXECUTION_PLAN.md
```

## Architecture In Plain English

```text
Renderer UI
  The visible app: sidebar, chat, composer, inspector, terminal, diff panel.

Preload bridge
  A narrow typed doorway called window.modus.

Electron main process
  The trusted side: workspace, Git, terminal, docs, model, permission, and agent services.

Rust PTY sidecar
  A small helper that runs real terminal sessions without putting native terminal code in React.

SQLite
  The local notebook where Modus remembers workspaces, sessions, events, permissions, docs, and
  terminal output.
```

The important part: the UI cannot freely touch your machine. It asks the main process through a
typed API. Dangerous agent tool calls pass through a permission extension before they run.

## Tech Stack

| Layer | Current implementation |
| --- | --- |
| Desktop | Electron 42, electron-vite |
| UI | React 19, Base UI, Tailwind CSS v4, Motion, Tabler Icons |
| Terminal | xterm.js plus Rust `modus-pty-host` |
| Agent runtime | `@earendil-works/pi-coding-agent` PI SDK |
| Local data | Node `node:sqlite` |
| Diff and Git | Git CLI services |
| Quality | TypeScript, Biome, Vitest |
| Packaging | electron-builder |

## What Is Still Early

Modus is usable as a local prototype, but it is still young:

- The UI is still being polished toward a Cursor-class feel.
- Permission review exists, but the user-facing approval flow is still early.
- Terminal output is stored, but full terminal replay is not mature yet.
- Markdown docs can be indexed and searched, but this is not a full knowledge base.
- Worktrees can be managed, but full task orchestration is still ahead.
- Cross-platform packaging, signing, auto-update, and release channels are not finished.
- This checkout does not currently include a license file; add one before distributing builds.

## Development Commands

```bash
npm run dev
npm run check
npm run format
npm run test
npm --workspace @modus/desktop run build
npm --workspace @modus/desktop run package:win -- --publish never
cargo check -p modus-pty-host
```

## Where Modus Is Going

The north star is simple: make AI coding work feel less like handing your repo to a stranger and
more like collaborating at a clear, local, well-lit desk.

Near-term work is focused on a sharper agent timeline, stronger permission prompts, richer context,
better diff review, more reliable terminal behavior, and smoother worktree-based task isolation.

If that sounds like the kind of coding agent window you want to use, Modus is the workshop.
