import { describe, expect, it } from "vitest";
import type { FileChange } from "../../../../shared/contracts";
import {
  CHANGE_SCOPES,
  changeBadge,
  filterByScope,
  SCOPE_META,
  splitPath,
  stageState,
} from "./changeScopes";

/** Build a synthetic change; only the fields under test are overridden. */
function change(over: Partial<FileChange> & { path: string; status: string }): FileChange {
  return { staged: false, unstaged: false, untracked: false, ...over };
}

describe("changeScopes", () => {
  // A deliberately mixed working tree, including a never-special-cased "partial"
  // (staged AND re-edited) and a rename — to prove the predicates are generic.
  const tree: FileChange[] = [
    change({ path: "staged-only.ts", status: "M", staged: true }),
    change({ path: "unstaged-only.ts", status: "M", unstaged: true }),
    change({ path: "partial.ts", status: "MM", staged: true, unstaged: true }),
    change({ path: "fresh.ts", status: "??", untracked: true }),
    change({ path: "renamed.ts", status: "R100", staged: true, renamedFrom: "old.ts" }),
  ];

  it("uncommitted scope shows every working-tree change", () => {
    expect(filterByScope(tree, "uncommitted").map((c) => c.path)).toEqual([
      "staged-only.ts",
      "unstaged-only.ts",
      "partial.ts",
      "fresh.ts",
      "renamed.ts",
    ]);
  });

  it("staged scope shows files with any staged content (incl. partial + rename)", () => {
    expect(filterByScope(tree, "staged").map((c) => c.path)).toEqual([
      "staged-only.ts",
      "partial.ts",
      "renamed.ts",
    ]);
  });

  it("unstaged scope shows unstaged + untracked (incl. partial)", () => {
    expect(filterByScope(tree, "unstaged").map((c) => c.path)).toEqual([
      "unstaged-only.ts",
      "partial.ts",
      "fresh.ts",
    ]);
  });

  it("history scope is not a working-tree filter", () => {
    expect(filterByScope(tree, "all-commits")).toEqual([]);
    expect(SCOPE_META["all-commits"].commitHistory).toBe(true);
  });

  it("every scope is registered with a label and noun", () => {
    for (const scope of CHANGE_SCOPES) {
      expect(SCOPE_META[scope].label).toBeTruthy();
      expect(SCOPE_META[scope].noun).toBeTruthy();
    }
  });

  it("derives tri-state staging from independent git flags", () => {
    expect(stageState(change({ path: "a", status: "M", staged: true }))).toBe("staged");
    expect(stageState(change({ path: "b", status: "M", unstaged: true }))).toBe("unstaged");
    expect(stageState(change({ path: "c", status: "??", untracked: true }))).toBe("unstaged");
    expect(stageState(change({ path: "d", status: "MM", staged: true, unstaged: true }))).toBe(
      "partial",
    );
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
