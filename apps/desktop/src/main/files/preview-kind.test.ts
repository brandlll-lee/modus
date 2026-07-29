import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectPreviewKind, readWorkspacePreview } from "./preview-kind";

/** Synthetic ZIP-like buffer whose local headers contain OOXML part names as plain strings. */
function zipWithParts(...parts: string[]): Buffer {
  const body = parts.map((part) => `PK\x03\x04xxxx${part}\x00`).join("");
  return Buffer.from(`PK\x03\x04${body}`);
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "modus-preview-"));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("detectPreviewKind (authoritative magic / part peek)", () => {
  it("classifies PDF by header", () => {
    expect(detectPreviewKind(Buffer.from("%PDF-1.7\n1 0 obj\n"))).toBe("pdf");
  });

  it("classifies common image magics", () => {
    expect(detectPreviewKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      "image",
    );
    expect(detectPreviewKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]))).toBe("image");
    expect(detectPreviewKind(Buffer.from("GIF89a......"))).toBe("image");
    expect(
      detectPreviewKind(Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])),
    ).toBe("image");
  });

  it("classifies OOXML by ZIP magic + internal part names (not filename)", () => {
    expect(detectPreviewKind(zipWithParts("word/document.xml"))).toBe("docx");
    expect(detectPreviewKind(zipWithParts("xl/workbook.xml"))).toBe("xlsx");
    expect(detectPreviewKind(zipWithParts("ppt/presentation.xml"))).toBe("pptx");
  });

  it("marks legacy OLE compound files unsupported", () => {
    expect(detectPreviewKind(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBe(
      "unsupported",
    );
  });

  it("marks unknown binary unsupported", () => {
    expect(detectPreviewKind(Buffer.from([1, 2, 0, 3, 4, 5]))).toBe("unsupported");
  });
});

describe("readWorkspacePreview", () => {
  it("returns bytes + kind for a PDF under the workspace", () => {
    const path = join(root, "doc.pdf");
    const bytes = Buffer.from("%PDF-1.4\n%%EOF\n");
    writeFileSync(path, bytes);
    const result = readWorkspacePreview(root, path);
    expect(result.previewKind).toBe("pdf");
    expect(result.mime).toBe("application/pdf");
    expect(result.size).toBe(bytes.length);
    expect(Buffer.from(result.bytes)).toEqual(bytes);
  });

  it("rejects paths outside the workspace", () => {
    expect(() => readWorkspacePreview(root, join(root, "..", "secret.pdf"))).toThrow(/outside/);
  });

  it("rejects files over the preview size cap", () => {
    mkdirSync(join(root, "big"), { recursive: true });
    const path = join(root, "big", "huge.bin");
    // Cap is enforced by size check before full read — write a stub and spy via tiny file
    // that we treat as over-cap by calling with an explicit low limit in the test helper.
    writeFileSync(path, Buffer.from("%PDF-1.4\noversize\n"));
    expect(() => readWorkspacePreview(root, path, { maxBytes: 4 })).toThrow(/too large|limit/i);
  });
});
