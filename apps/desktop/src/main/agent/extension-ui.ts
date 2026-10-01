import { AsyncLocalStorage } from "node:async_hooks";
import {
  type AgentSession,
  type ExtensionUIContext,
  type ExtensionUIDialogOptions,
  initTheme,
} from "@earendil-works/pi-coding-agent";
import type { AgentEvent } from "../../shared/contracts";
import { requestQuestions } from "../interaction/question-broker";

const commandOutput = new AsyncLocalStorage<string[]>();
const activeCommands = new WeakSet<AgentSession>();

export function isExtensionCommandActive(session: AgentSession): boolean {
  return activeCommands.has(session);
}

export function createExtensionUI(
  session: AgentSession,
  sessionId: string,
  emit: (event: AgentEvent) => void,
): ExtensionUIContext {
  initTheme(session.settingsManager.getTheme());
  const runner = session.extensionRunner;
  if (!runner) throw new Error("Session extensions are not initialized.");
  const ask = async (
    title: string,
    options: string[],
    placeholder?: string,
    opts?: ExtensionUIDialogOptions,
    prefill?: string,
  ) => {
    const response = await requestQuestions({
      sessionId,
      emit,
      signal: opts?.signal,
      timeoutMs: opts?.timeout,
      presentation: "dialog",
      questions: [
        {
          id: "extension",
          header: title,
          multiSelect: false,
          options: options.map((label) => ({ label })),
          ...(placeholder ? { detail: placeholder } : {}),
          ...(prefill !== undefined ? { prefill } : {}),
        },
      ],
    });
    if (response.skipped) return undefined;
    const answer = response.answers[0];
    return answer?.selected[0] ?? answer?.custom;
  };
  return {
    ...runner.getUIContext(),
    select: (title, options, opts) => ask(title, options, undefined, opts),
    input: (title, placeholder, opts) => ask(title, [], placeholder, opts),
    editor: (title, prefill) => ask(title, [], undefined, undefined, prefill),
    confirm: async (title, message, opts) =>
      (await ask(title, ["Confirm", "Cancel"], message, opts)) === "Confirm",
    notify(message, level = "info") {
      const output = commandOutput.getStore();
      if (output) output.push(message);
      else emit({ type: "extension.notice", sessionId, message, level });
    },
  };
}

export async function invokeExtensionCommand(
  session: AgentSession,
  name: string,
  args = "",
): Promise<string> {
  if (!session.extensionRunner?.getCommand(name))
    throw new Error(`The ${name} extension is not loaded in this session.`);
  if (activeCommands.has(session))
    throw new Error("Wait for the current extension command to finish.");
  activeCommands.add(session);
  const output: string[] = [];
  try {
    await commandOutput.run(output, () =>
      session.prompt(`/${name}${args ? ` ${args}` : ""}`, { source: "rpc" }),
    );
    return output.join("\n\n");
  } finally {
    activeCommands.delete(session);
  }
}
