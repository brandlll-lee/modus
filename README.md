<p align="center">
  English | <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img alt="Modus logo" src="./docs/media/modus-logo.png" width="104" height="104">
</p>

<h1 align="center">Modus</h1>

<p align="center">
  The open-source, local-first desktop workspace for AI coding agents.
</p>

<p align="center">
  <img alt="Status" src="https://img.shields.io/badge/status-active%20prototype-black">
  <img alt="Version" src="https://img.shields.io/badge/version-0.1.0-52525b">
  <img alt="Electron" src="https://img.shields.io/badge/Electron-42-47848f?logo=electron&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=white">
  <img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue">
</p>

![Modus desktop UI](./docs/media/modus-ui.png)

---

Modus is a desktop app for working with AI coding agents in a real local checkout.

Open a project, choose your model, plan the work, let the agent build, and watch the
commands, diffs, browser tabs, terminals, checkpoints, and permission prompts in one place.
Your project stays on your machine.

Modus is early. It runs from source today. Packaged installers are still a release task.

### Quick start

```bash
# Requirements: Node >= 22.19.0, npm, Rust + Cargo, Git
git clone https://github.com/brandlll-lee/modus.git
cd modus
npm install
npm run dev
```

Then:

1. Open a workspace folder.
2. Connect a model provider in Settings.
3. Start a chat, or switch to Plan Mode first.
4. Review changes in the right panel before committing or pushing.

### What it does

- **Plan before build** - Plan Mode researches, asks structured questions, and writes a reviewable `plan.md` before code changes.
- **Visible agent work** - The timeline shows messages, tool calls, terminal runs, diffs, todos, checkpoints, retries, and permission requests.
- **Bring your own models** - Configure built-in or custom PI-compatible providers, model limits, reasoning, and thinking variants.
- **Real source control** - Review working changes, staged changes, commit history, branches, file diffs, commits, and pushes.
- **Real terminals** - Run user and agent terminals through a Rust PTY sidecar, rendered with xterm.js.
- **In-app browser** - Open pages, inspect tabs, use DevTools, capture screenshots, and let the agent drive browser tools.
- **Context that stays local** - Attach files, folders, docs, Git diffs, terminal output, browser state, images, recent changes, rules, and selected page elements.
- **MCP and skills** - Add Modus-owned MCP servers from `~/.modus/mcp.json` or `<workspace>/.modus/mcp.json`, and invoke local skills with `/`.
- **Permissioned execution** - Shell, Git, browser, MCP, and external actions go through the same approval flow.
- **Rollback points** - Pre-run checkpoints let you restore a session's workspace state from the timeline.

### How it feels

The left side is your project shelf: workspaces, sessions, pinned projects, and activity.

The center is the chat: prompt, plan, build, edit and resend, stop, steer, attach context, or switch models mid-task.

The right side is the inspector: Changes, Plan, Files, Browser, Terminal, and Security.

Settings handles providers, models, MCP servers, skills, rules, and approval policy.

### MCP config

Modus only auto-loads its own MCP files:

```text
~/.modus/mcp.json
<workspace>/.modus/mcp.json
```

It does not silently import Cursor, Claude, Warp, or other agent configs. If you want a server
inside Modus, add it to Modus.

### Architecture

```text
Renderer (React)
  Sidebar, timeline, composer, inspector, settings

Preload bridge
  Typed window.modus API, no direct Node access in the renderer

Electron main
  Workspace, Git, browser, terminal, docs, models, MCP, skills, permissions, agent runtime

Rust PTY sidecar
  Real terminal sessions through portable-pty

SQLite
  Workspaces, sessions, events, permissions, docs, reviews, checkpoints, terminal output
```

For security details, see [desktop security notes](./docs/architecture/desktop-security.md).

### Tech stack

- Electron 42, electron-vite
- React 19, Base UI, Tailwind CSS v4, Motion, Tabler Icons
- Monaco, xterm.js, Streamdown
- `@earendil-works/pi-coding-agent`
- `@modelcontextprotocol/sdk`
- Rust `portable-pty`
- Node `node:sqlite`
- TypeScript, Biome, Vitest

### Development

```bash
npm run dev          # run the desktop app
npm run check        # Biome + typecheck
npm run test         # Vitest
npm run format       # Biome --write

npm --workspace @modus/desktop run typecheck
npm --workspace @modus/desktop run build
npm --workspace @modus/desktop run package:win -- --publish never
cargo check -p modus-pty-host
```

### Project layout

```text
modus/
├─ apps/
│  ├─ desktop/        # Electron desktop app
│  └─ web/            # Reserved for a future website
├─ crates/
│  └─ pty-host/       # Rust PTY sidecar
├─ docs/
│  ├─ architecture/   # Security and architecture notes
│  └─ media/          # README assets
└─ packages/          # Reserved shared packages
```

### Contributing

Contributions are welcome while the project is still young.

- Keep PRs small and easy to review.
- Use Conventional Commits.
- Run `npm run check` and `npm run test` before opening a PR.
- Prefer root-cause fixes over patches. Use real signals, not name lists or guesses.

### License

Apache-2.0. See [LICENSE](./LICENSE).
