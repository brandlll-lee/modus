import type { ExtensionFactory, ToolDefinition } from "@earendil-works/pi-coding-agent";

const runtimeTools = new WeakSet<object>();

/** PI's orchestration tools run in its sandbox; every host call has its own permission hook. */
export function withRuntimeToolPolicy(factory: ExtensionFactory): ExtensionFactory {
  return (pi) =>
    factory({
      ...pi,
      registerTool(definition) {
        runtimeTools.add(definition);
        pi.registerTool(definition);
      },
    });
}

export function isRuntimeTool(definition: ToolDefinition | undefined): boolean {
  return definition !== undefined && runtimeTools.has(definition);
}
