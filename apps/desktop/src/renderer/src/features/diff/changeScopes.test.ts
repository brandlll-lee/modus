import { describe, expect, it } from "vitest";
import type { FileChange } from "../../../../shared/contracts";
import { CHANGE_SCOPES, changeBadge, isChangeScope, SCOPE_META, splitPath } from "./changeScopes";

/** Build a synthetic change; only the fields under test are overridden. */
function change(over: Partial<FileChange> & { path: string; status: string }): FileChange {
  return { staged: false, unstaged: false, untracked: false, ...over };
}

describe("changeScopes", () => {
  it("registers exactly the six review scopes in menu order", () => {
    expect(CHANGE_SCOPES).toEqual([
      "unstaged",
      "staged",
      "commit",
      "branch",
      "last-turn",
      "all-commits",
    ]);
    expect(isChangeScope("uncommitted")).toBe(false);
    expect(isChangeScope("unstaged")).toBe(true);
  });

  it("every scope is registered with a label and noun", () => {
    for (const scope of CHANGE_SCOPES) {
      expect(SCOPE_META[scope].label).toBeTruthy();
      expect(SCOPE_META[scope].noun).toBeTruthy();
    }
  });

  it("classifies the badge from the status code, not the file name", () => {
    expect(changeBadge(change({ path: "x", status: "??", untracked: true }))).toBe("new");
    expect(changeBadge(change({ path: "x", status: "A", staged: true }))).toBe("new");
    expect(changeBadge(change({ path: "x", status: "D" }))).toBe("deleted");
    expect(changeBadge(change({ path: "x", status: "R100", renamedFrom: "y" }))).toBe("renamed");
    expect(changeBadge(change({ path: "x", status: "C75" }))).toBe("copied");
    expect(changeBadge(change({ path: "x", status: "M" }))).toBe("modified");
    // Combined code: rename that was also modified resolves to the dominant action.
    expect(changeBadge(change({ path: "x", status: "RM", staged: true }))).toBe("renamed");
  });

  it("splits paths into a dimmable directory prefix and a file name", () => {
    expect(splitPath("src/main/app.ts")).toEqual({ dir: "src/main/", name: "app.ts" });
    expect(splitPath("README.md")).toEqual({ dir: "", name: "README.md" });
    expect(splitPath("a\\b\\c.rs")).toEqual({ dir: "a/b/", name: "c.rs" });
  });
});
