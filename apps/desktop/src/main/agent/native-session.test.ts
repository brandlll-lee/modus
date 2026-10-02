import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  InMemoryCredentialStore,
} from "@earendil-works/pi-ai";
import {
  type AgentSession,
  createAgentSession,
  createCodemodeExtension,
  createToolSearchExtension,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { AgentEvent } from "../../shared/contracts";
import { resolveQuestionRequest } from "../interaction/question-broker";
import { createModusMcpExtension } from "../mcp/mcp-service";
import { createExtensionUI, invokeExtensionCommand } from "./extension-ui";
import { createPiEventNormalizer } from "./pi-event-normalizer";
import { createModusPermissionExtension } from "./pi-permission-extension";
import { isRuntimeTool, withRuntimeToolPolicy } from "./runtime-tools";

const approvals = vi.hoisted(() =>
  vi.fn(async (input: { target: string }) => ({
    decision: input.target.includes("novel_change") ? "deny" : "allow-once",
  })),
);
vi.mock("../permissions/permission-broker", () => ({ requestPermission: approvals }));
vi.mock("../permissions/permission-store", () => ({
  getApprovalMode: () => "auto",
  findWorkspaceAllowDecision: () => undefined,
}));
vi.mock("./agent-run-store", () => ({ getActiveAgentRun: () => undefined }));
vi.mock("electron", () => ({ shell: { openExternal: vi.fn() } }));
vi.mock("./agent-paths", () => ({ getPiCliAgentDir: () => join(root, "cli") }));
vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  homedir: () => join(root, "home"),
}));
let root: string;
let session: AgentSession;
const faux = fauxProvider({ tokensPerSecond: 0 });
const events: AgentEvent[] = [];
let executions = 0;
let shutdowns = 0;
const env = process.env.PI_CODING_AGENT_DIR;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "modus-native-session-"));
  const agentDir = join(root, "agent");
  process.env.PI_CODING_AGENT_DIR = agentDir;
  mkdirSync(join(root, ".pi"), { recursive: true });
  writeFileSync(
    join(root, ".pi", "mcp.json"),
    JSON.stringify({
      mcpServers: {
        fixture: {
          command: process.execPath,
          args: [fileURLToPath(new URL("../mcp/fixtures/server.mjs", import.meta.url))],
          env: { ELECTRON_RUN_AS_NODE: "1" },
        },
      },
    }),
  );
  mkdirSync(join(root, ".modus", "skills", "inspect"), { recursive: true });
  writeFileSync(
    join(root, ".modus", "skills", "inspect", "SKILL.md"),
    "---\nname: inspect\ndescription: Inspect a synthetic fixture\n---\nNATIVE SKILL BODY\n",
  );
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false,
  });
  runtime.registerNativeProvider(faux.provider);
  await runtime.refresh({ allowNetwork: false });
  const settingsManager = SettingsManager.inMemory(
    { compaction: { enabled: false }, defaultTools: ["+codemode", "+tool_search"] },
    { projectTrusted: true },
  );
  writeFileSync(join(root, "AGENTS.md"), "SYNTHETIC_WORKSPACE_INSTRUCTIONS");
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir,
    settingsManager,
    noThemes: true,
    noPromptTemplates: true,
    additionalSkillPaths: [join(root, ".modus", "skills")],
    extensionFactories: [
      {
        name: "codemode",
        factory: withRuntimeToolPolicy(createCodemodeExtension({ models: false })),
      },
      { name: "tool_search", factory: withRuntimeToolPolicy(createToolSearchExtension()) },
      { name: "mcp", factory: createModusMcpExtension() },
      createModusPermissionExtension("native", (event) => events.push(event), root, {
        definition: (name) => session.getToolDefinition(name),
        source: (name) => session.getAllTools().find((tool) => tool.name === name)?.sourceInfo,
        allows: () => true,
      }),
      (pi) => {
        pi.registerTool({
          name: "novel_change",
          label: "Change",
          description: "Synthetic mutation",
          parameters: Type.Object({}),
          exposure: "codemode",
          execute: async () => {
            executions++;
            return { content: [{ type: "text", text: "changed" }], details: {} };
          },
        });
        pi.on("session_shutdown", () => {
          shutdowns++;
        });
      },
    ],
  });
  await loader.reload();
  expect(
    loader.getAgentsFiles().agentsFiles.filter((file) => file.path === join(root, "AGENTS.md")),
  ).toHaveLength(1);
  ({ session } = await createAgentSession({
    cwd: root,
    agentDir,
    modelRuntime: runtime,
    model: faux.getModel(),
    settingsManager,
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(root),
  }));
  expect(session.systemPrompt.split("SYNTHETIC_WORKSPACE_INSTRUCTIONS")).toHaveLength(2);
  const normalize = createPiEventNormalizer("native");
  session.subscribe((event) => events.push(...normalize(event)));
  await session.bindExtensions({
    mode: "rpc",
    uiContext: createExtensionUI(session, "native", (event) => {
      events.push(event);
      if (event.type === "question.requested")
        queueMicrotask(() =>
          resolveQuestionRequest(
            event.request.id,
            [{ questionId: "extension", selected: [], custom: "response" }],
            false,
          ),
        );
    }),
  });
}, 60_000);

afterAll(async () => {
  try {
    await session?.extensionRunner?.emit({ type: "session_shutdown", reason: "quit" });
  } finally {
    session?.dispose();
    if (env === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = env;
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

it("registers native orchestration by definition identity and returns MCP reports through RPC", async () => {
  const report = await invokeExtensionCommand(session, "mcp");
  expect(report).toContain("fixture");
  expect(session.getAllTools().some((tool) => tool.namespace?.name === "mcp__fixture")).toBe(true);
  expect(isRuntimeTool(session.getToolDefinition("codemode"))).toBe(true);
  expect(isRuntimeTool({ name: "codemode" } as never)).toBe(false);
  expect(await invokeExtensionCommand(session, "mcp", "reconnect fixture")).toContain(
    "Reconnected",
  );
}, 30_000);

it("runs nested MCP calls, retains parentage, and blocks nested mutations before execution", async () => {
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall(
        "codemode",
        {
          code: 'text(await tools.mcp__fixture__lookup({value:"nested-result"})); text(await tools.novel_change({}));',
        },
        { id: "parent" },
      ),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("Finished"),
  ]);
  await session.prompt("Execute the fixture");
  expect(executions).toBe(0);
  expect(approvals).toHaveBeenCalledTimes(2);
  expect(approvals).toHaveBeenCalledWith(
    expect.objectContaining({
      action: "tool.execute",
      target: expect.stringContaining("novel_change"),
    }),
  );
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "tool.started",
      parentToolCallId: "parent",
      toolName: "mcp__fixture__lookup",
    }),
  );
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "tool.ended",
      parentToolCallId: "parent",
      isError: false,
      output: expect.stringContaining("nested-result"),
    }),
  );
  expect(events).toContainEqual(expect.objectContaining({ type: "agent.ended" }));
}, 30_000);

it("uses native skill invocation and GUI dialog callbacks after reload", async () => {
  await session.reload();
  expect(shutdowns).toBe(1);
  expect(await session.extensionRunner?.getUIContext().input("Fixture input")).toBe("response");
  faux.setResponses([fauxAssistantMessage("Skill finished")]);
  await session.prompt("/skill:inspect target");
  expect(JSON.stringify(session.messages)).toContain("NATIVE SKILL BODY");
  expect(JSON.stringify(session.messages)).toContain("<skill name=");
});

it("carries a native read image through the SDK event adapter", async () => {
  const data =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  writeFileSync(join(root, "fixture.png"), Buffer.from(data, "base64"));
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("read", { path: "fixture.png" }, { id: "native-image" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("Viewed"),
  ]);
  await session.prompt("Inspect fixture.png");
  const result = events.find(
    (event) => event.type === "tool.ended" && event.toolCallId === "native-image",
  );
  expect(result).toMatchObject({
    type: "tool.ended",
    isError: false,
    output: expect.stringContaining("Read image file"),
    images: [{ type: "image", mimeType: "image/png", data: expect.any(String) }],
  });
  expect(result && "output" in result ? result.output : "").not.toContain(data);
});
