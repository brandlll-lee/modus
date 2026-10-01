import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

const paths = vi.hoisted(() => ({ agent: "" }));
vi.mock("./agent-paths", () => ({ getPiCliAgentDir: () => paths.agent }));
vi.mock("electron", () => ({ shell: { openExternal: vi.fn(), openPath: vi.fn() } }));

import { listSkills } from "../skills/skills-service";
import { createAgentResourceLoader } from "./agent-resources";
import { createAgentSettings } from "./agent-settings";
import { createExtensionUI } from "./extension-ui";
import { createPiEventNormalizer } from "./pi-event-normalizer";
import { registerSessionResources, releaseSessionResources } from "./session-resources";

let root: string;
let cwd: string;
function put(path: string, text: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "modus-pi-resources-"));
  paths.agent = join(root, "agent");
  cwd = join(root, "project");
  put(join(paths.agent, "settings.json"), JSON.stringify({ defaultTools: ["read"] }));
  put(
    join(paths.agent, "skills", "synthetic", "SKILL.md"),
    "---\nname: synthetic\ndescription: Native fixture\n---\nSkill body.\n",
  );
  put(join(cwd, "AGENTS.md"), "WORKSPACE_FIXTURE");
  put(
    join(cwd, ".pi", "extensions", "fixture.ts"),
    'export default function(pi) { pi.registerCommand("mcp", {description:"Fixture manager", handler:async()=>{}}); }',
  );
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

it("uses native discovery and lets a trusted extension replace builtin MCP", async () => {
  const settings = createAgentSettings({ cwd });
  const loader = await createAgentResourceLoader(cwd, settings, []);
  expect(loader.getExtensions().extensions.some((item) => item.path === "builtin:mcp")).toBe(true);
  settings.setProjectTrusted(true);
  await loader.reload();
  const native = new DefaultResourceLoader({
    cwd,
    agentDir: paths.agent,
    settingsManager: settings,
  });
  await native.reload();
  expect(loader.getSkills()).toEqual(native.getSkills());
  expect(loader.getAgentsFiles()).toEqual(native.getAgentsFiles());
  expect(loader.getExtensions().extensions.some((item) => item.path === "builtin:mcp")).toBe(false);
  expect(loader.getExtensions().errors).toEqual([]);
  expect(loader.getExtensions().extensions.some((item) => item.path.endsWith("fixture.ts"))).toBe(
    true,
  );
});

it("restores persisted SDK usage and skills and keeps desktop tools deferred", async () => {
  const faux = fauxProvider({ tokensPerSecond: 0 });
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false,
  });
  modelRuntime.registerNativeProvider(faux.provider);
  await modelRuntime.refresh({ allowNetwork: false });
  const settings = SettingsManager.inMemory(
    { defaultTools: ["read"], compaction: { enabled: false } },
    { projectTrusted: true },
  );
  const loader = await createAgentResourceLoader(cwd, settings, [
    {
      name: "session-ui",
      factory: (pi) => {
        pi.on("session_start", (_event, ctx) => {
          ctx.ui.notify(ctx.ui.theme.fg("accent", "UI_READY"));
        });
      },
    },
  ]);
  const options = {
    cwd,
    agentDir: paths.agent,
    modelRuntime,
    model: faux.getModel(),
    settingsManager: settings,
    resourceLoader: loader,
    customTools: [
      {
        name: "desktop_fixture",
        label: "Fixture",
        description: "Synthetic desktop operation",
        exposure: "deferred" as const,
        parameters: Type.Object({}),
        execute: async () => ({ content: [], details: {} }),
      },
    ],
  };
  const { session } = await createAgentSession({
    ...options,
    sessionManager: SessionManager.create(cwd, join(root, "sessions")),
  });
  const notices: string[] = [];
  await session.bindExtensions({
    mode: "rpc",
    uiContext: createExtensionUI(session, "fixture", (event) => {
      if (event.type === "extension.notice") notices.push(event.message);
    }),
  });
  expect(notices.some((message) => message.includes("UI_READY"))).toBe(true);
  const response = fauxAssistantMessage("Hello");
  response.usage = {
    input: 120,
    output: 20,
    cacheRead: 70,
    cacheWrite: 15,
    totalTokens: 225,
    cost: { input: 0.01, output: 0.02, cacheRead: 0.003, cacheWrite: 0.004, total: 0.037 },
  };
  faux.setResponses([response]);
  const lifecycle: string[] = [];
  const normalize = createPiEventNormalizer("fixture");
  const unsubscribe = session.subscribe((event) => {
    for (const item of normalize(event)) {
      if (
        item.type === "agent.started" ||
        item.type === "turn.started" ||
        item.type === "agent.ended"
      )
        lifecycle.push(item.type);
    }
  });
  await session.prompt("hello");
  unsubscribe();
  expect(lifecycle).toEqual(["agent.started", "turn.started", "agent.ended"]);
  expect(session.getActiveToolNames()).toEqual(expect.arrayContaining(["read", "tool_search"]));
  expect(session.getActiveToolNames()).not.toContain("desktop_fixture");
  expect(session.getActiveToolNames()).not.toContain("codemode");
  const stats = session.getSessionStats();
  expect(stats.tokens.input).toBeGreaterThan(0);
  expect(session.sessionFile).toBeDefined();
  const file = session.sessionFile as string;
  session.dispose();
  const restoredLoader = await createAgentResourceLoader(cwd, settings, []);
  const { session: restored } = await createAgentSession({
    ...options,
    resourceLoader: restoredLoader,
    sessionManager: SessionManager.open(file),
  });
  try {
    expect(restored.getSessionStats()).toMatchObject({
      tokens: stats.tokens,
      cost: stats.cost,
      contextUsage: stats.contextUsage,
    });
    registerSessionResources({ id: "cold", cwd, session: restored, loader: restoredLoader });
    expect(listSkills("cold").skills.some((skill) => skill.name === "synthetic")).toBe(true);
  } finally {
    releaseSessionResources("cold");
    restored.dispose();
  }
}, 30_000);
