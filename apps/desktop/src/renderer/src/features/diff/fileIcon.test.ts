import { IconFile, IconFileTypeTsx, IconJson } from "@tabler/icons-react";
import { describe, expect, it } from "vitest";
import { FALLBACK_FILE_ICON, iconComponentForPath } from "./fileIcon";

describe("fileIcon", () => {
  it("maps known extensions to their glyph, regardless of directory depth", () => {
    expect(iconComponentForPath("src/app/Main.tsx")).toBe(IconFileTypeTsx);
    expect(iconComponentForPath("data\\config.json")).toBe(IconJson);
  });

  it("special-cases exact file names", () => {
    expect(iconComponentForPath("project/package.json")).toBe(IconJson);
  });

  it("falls back to the generic glyph for never-listed extensions", () => {
    // Extensions intentionally absent from the table — proves no per-type branch.
    expect(iconComponentForPath("model.safetensors")).toBe(FALLBACK_FILE_ICON);
    expect(iconComponentForPath("notes.flargle")).toBe(IconFile);
    expect(iconComponentForPath("LICENSE")).toBe(IconFile);
  });
});
