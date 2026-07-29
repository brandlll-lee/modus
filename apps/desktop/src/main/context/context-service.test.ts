import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveContext } from "./context-service";

const execFileAsync = promisify(execFile);
let repo: string;

async function git(args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd: repo, windowsHide: true });
}

beforeEach(async () => {
  repo = await mkdtemp(join(process.cwd(), "modus-context-test-"));
  await git(["init"]);
  await git(["config", "user.email", "test@example.com"]);
  await git(["config", "user.name", "Modus Test"]);
  await writeFile(join(repo, "tracked.txt"), "base\n");
  await writeFile(join(repo, "AGENTS.md"), "Follow project rules.\n");
  await git(["add", "."]);
  await git(["commit", "-m", "initial"]);
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe("context-service", () => {
  it("ignores file context outside cwd", async () => {
    const outside = join(process.cwd(), "outside.txt");
    const resolved = await resolveContext(repo, [{ type: "file", path: outside }]);

    expect(resolved).toEqual([]);
  });

  it("resolves a file range to the selected lines", async () => {
    await writeFile(join(repo, "sample.ts"), "one\ntwo\nthree\nfour\n");
    const resolved = await resolveContext(repo, [
      { type: "file", path: join(repo, "sample.ts"), range: { fromLine: 2, toLine: 3 } },
    ]);

    expect(resolved[0]?.title).toContain(":L2-3");
    expect(resolved[0]?.content).toBe("two\nthree");
  });

  it("resolves project rules", async () => {
    const resolved = await resolveContext(repo, [{ type: "rules" }]);

    expect(resolved[0]?.content).toContain("Follow project rules");
  });

  it("resolves recent changes with status and diff stat", async () => {
    await writeFile(join(repo, "tracked.txt"), "changed\n");
    const resolved = await resolveContext(repo, [{ type: "recent-changes", limit: 5 }]);

    expect(resolved[0]?.content).toContain("Status");
    expect(resolved[0]?.content).toContain("Diff stat");
  });

  it("formats a design-element with its component and source line for the model", async () => {
    const resolved = await resolveContext(repo, [
      {
        type: "design-element",
        element: {
          id: "el-1",
          tabId: "tab-1",
          url: "https://example.com/docs",
          label: 'MDXContent · span "Kimi K2.7 Co…"',
          tagName: "span",
          componentName: "MDXContent",
          source: { file: "src/content/page.mdx", line: 42, column: 7 },
          domPath: "main > article > p:nth-of-type(2) > span",
          text: "Kimi K2.7 Code is…",
          styleSummary: { color: "rgb(156, 163, 175)", fontSize: "16px" },
          rect: { x: 10, y: 20, width: 300, height: 24 },
          screenshotDataUrl: "data:image/png;base64,AAAA",
        },
      },
    ]);

    const content = resolved[0]?.content ?? "";
    expect(content).toContain("MDXContent");
    expect(content).toContain("Preferred source");
    expect(content).toContain("Inspect this source first");
    expect(content).toContain("src/content/page.mdx:42:7");
    expect(content).toContain("<span>");
    expect(content).toContain("A screenshot of this element is attached");
  });

  it("formats multi-selected design elements for the model", async () => {
    const resolved = await resolveContext(repo, [
      {
        type: "design-element",
        element: {
          id: "group-1",
          tabId: "tab-1",
          url: "https://example.com/pricing",
          label: "2 selected elements",
          tagName: "selection",
          domPath: "h1 + button",
          rect: { x: 10, y: 20, width: 500, height: 140 },
          elements: [
            {
              label: "h1",
              tagName: "h1",
              domPath: "main > h1",
              text: "Pricing",
              styleSummary: { fontSize: "56px" },
              rect: { x: 10, y: 20, width: 240, height: 70 },
            },
            {
              label: "button",
              tagName: "button",
              domPath: "nav > button",
              text: "Contact sales",
              styleSummary: { borderRadius: "8px" },
              rect: { x: 320, y: 30, width: 190, height: 44 },
            },
          ],
          screenshotDataUrl: "data:image/png;base64,AAAA",
        },
      },
    ]);

    const content = resolved[0]?.content ?? "";
    expect(content).toContain("Selected elements:");
    expect(content).toContain("1. h1");
    expect(content).toContain("Text: \"Pricing\"");
    expect(content).toContain("2. button");
    expect(content).toContain("DOM path: nav > button");
  });

  it("formats a design annotation as visual evidence for the model", async () => {
    const resolved = await resolveContext(repo, [
      {
        type: "design-annotation",
        annotation: {
          id: "annotation-1",
          tabId: "tab-1",
          url: "https://example.com/pricing",
          label: "Selected region",
          kind: "box",
          rect: { x: 12, y: 34, width: 320, height: 180 },
          seedText: "Make this area less muted.",
          screenshotDataUrl: "data:image/png;base64,AAAA",
        },
      },
    ]);

    const content = resolved[0]?.content ?? "";
    expect(content).toContain("Visual annotation");
    expect(content).toContain("User note: Make this area less muted.");
    expect(content).toContain("width=320");
    expect(content).toContain("visual evidence only");
    expect(content).toContain("A screenshot of the marked region is attached");
  });

  it("resolves an excerpt from capture-time text without reading the file", async () => {
    const pdfPath = join(repo, "notes.pdf");
    await writeFile(pdfPath, "%PDF-1.4 binary garbage that is not utf8 lines\n");
    const text = "What distinguishes diffusion models from other latent variable models";
    const resolved = await resolveContext(repo, [
      { type: "excerpt", path: pdfPath, text, locator: "p.1" },
    ]);

    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.title).toContain("notes.pdf");
    expect(resolved[0]?.title).toContain("p.1");
    expect(resolved[0]?.content).toBe(text);
  });

  it("resolves an excerpt even when path is outside cwd (text is capture-time authority)", async () => {
    const text = "outside path must still inject";
    const resolved = await resolveContext(repo, [
      {
        type: "excerpt",
        path: join(process.cwd(), "outside.pdf"),
        text,
        locator: "p.9",
      },
    ]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.content).toBe(text);
  });
});
