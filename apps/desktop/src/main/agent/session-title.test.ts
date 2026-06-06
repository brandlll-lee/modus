import { describe, expect, it } from "vitest";
import { deriveSessionTitle, shouldReplaceSessionTitle } from "./session-title";

describe("session title helpers", () => {
  it("replaces only empty or default session titles", () => {
    expect(shouldReplaceSessionTitle(undefined)).toBe(true);
    expect(shouldReplaceSessionTitle("")).toBe(true);
    expect(shouldReplaceSessionTitle("New chat")).toBe(true);
    expect(shouldReplaceSessionTitle("Modus local agent")).toBe(true);
    expect(shouldReplaceSessionTitle("Investigate markdown rendering")).toBe(false);
  });

  it("derives a compact title from the first prompt", () => {
    expect(deriveSessionTitle("你好，介绍一下你自己")).toBe("介绍一下你自己");
    expect(deriveSessionTitle("/investigate 请帮我修复 Markdown 渲染和流式输出问题")).toBe(
      "请帮我修复 Markdown 渲染和流式输出问题",
    );
  });

  it("strips noisy blocks and truncates long prompts", () => {
    const title = deriveSessionTitle(
      "```ts\nconsole.log('x')\n```\n请全面重构我们的模型设置和 provider 管理界面，确保可维护可扩展可测试",
    );

    expect(title).toBe("请全面重构我们的模型设置和 provider 管理界面，确保可维护可扩展可测试");
  });
});
