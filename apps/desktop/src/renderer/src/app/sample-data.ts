export const workspaces = [
  { id: "modus", name: "modus", path: "F:\\CodeHub\\modus", status: "Active" },
  { id: "future-web", name: "modus-web", path: "reserved/apps/web", status: "Reserved" },
];

export const sessions = [
  {
    id: "m0",
    title: "Bootstrap desktop shell",
    status: "Running",
    model: "pi runtime",
    branch: "main",
  },
  {
    id: "m1",
    title: "Design Agent Window UI",
    status: "Ready",
    model: "fake runtime",
    branch: "modus/m1-ui",
  },
  {
    id: "m2",
    title: "Open local workspace",
    status: "Queued",
    model: "pi runtime",
    branch: "modus/m2-workspace",
  },
];

export const timeline = [
  {
    id: "1",
    role: "user",
    title: "User",
    body: "Create the first local-first Modus desktop milestone from the V0.1.0 execution plan.",
  },
  {
    id: "2",
    role: "assistant",
    title: "Modus Agent",
    body: "Scaffolding Electron, secure preload IPC, and the Agent Window shell before native runtime integration.",
  },
  {
    id: "3",
    role: "tool",
    title: "Tool call: app.securityState",
    body: "contextIsolation=true, nodeIntegration=false, sandbox=true, senderValidation=true",
  },
];

export const changedFiles = [
  { path: "apps/desktop/src/main/index.ts", status: "added", lines: "+42" },
  { path: "apps/desktop/src/preload/index.ts", status: "added", lines: "+10" },
  { path: "apps/desktop/src/renderer/src/app/App.tsx", status: "added", lines: "+160" },
];
