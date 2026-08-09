import { describe, expect, it } from "vitest";
import { getSlashQuery } from "./useComposerSlash";

describe("getSlashQuery", () => {
  it("opens for a bare slash", () => {
    expect(getSlashQuery("/")).toEqual({ start: 0, query: "" });
  });

  it("opens for slash tokens after existing text", () => {
    expect(getSlashQuery("请你使用 /ponytail")).toEqual({ start: 5, query: "ponytail" });
  });

  it("does not open for URL path slashes", () => {
    expect(getSlashQuery("open https://example.com/docs")).toBeUndefined();
  });
});
