import { describe, expect, it } from "vitest";
import { inspectDiff, parseReviewOutput } from "./review-service";

describe("review-service", () => {
  it("parses strict JSON review output", () => {
    const result = parseReviewOutput(
      '{"summary":"Looks good","issues":[{"severity":"high","title":"Bug","file":"src/a.ts","line":12,"detail":"Breaks flow"}]}',
      "",
    );

    expect(result.summary).toBe("Looks good");
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ severity: "high", title: "Bug" });
    expect(result.issues[0]?.id).toBeTruthy();
  });

  it("parses fenced JSON review output", () => {
    const result = parseReviewOutput('```json\n{"summary":"Done","issues":[]}\n```', "");

    expect(result).toMatchObject({ summary: "Done", issues: [] });
  });

  it("falls back to heuristic issues", () => {
    const diff = `diff --git a/.env b/.env
+++ b/.env
@@ -0,0 +1 @@
+api_key = "secret"`;
    const result = parseReviewOutput("not json", diff);

    expect(result.summary).toBe("not json");
    expect(result.issues[0]?.title).toBe("Possible secret in added code");
  });

  it("detects heuristic TODO and secrets", () => {
    const diff = `diff --git a/src/a.ts b/src/a.ts
+++ b/src/a.ts
@@ -1,0 +1,2 @@
+const token = "abc";
+// TODO finish`;

    expect(inspectDiff(diff).map((issue) => issue.title)).toEqual([
      "Possible secret in added code",
      "Unresolved TODO in diff",
    ]);
  });
});
