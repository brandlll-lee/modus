import { describe, expect, it } from "vitest";
import { fileRefCore, looksLikeFileRef } from "./FileRefChip";

describe("fileRefCore", () => {
  it("trims whitespace only", () => {
    expect(fileRefCore("  notes.md  ")).toBe("notes.md");
  });
});

describe("looksLikeFileRef", () => {
  it("accepts path-like refs and rejects prose", () => {
    expect(looksLikeFileRef("checkpoint_manager.py")).toBe(true);
    expect(looksLikeFileRef("src/main.ts")).toBe(true);
    expect(looksLikeFileRef("just some words")).toBe(false);
    expect(looksLikeFileRef("npm")).toBe(false);
  });
});
