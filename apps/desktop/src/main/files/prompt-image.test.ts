import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { expect, it } from "vitest";
import { preparePromptImage } from "./prompt-image";

it("saves clipboard bytes as an absolute temporary path and keeps supplied files intact", async () => {
  const bytes = Buffer.from("synthetic clipboard pixels");
  const image = { data: bytes.toString("base64"), mimeType: "image/png" };
  const path = await preparePromptImage(image);
  try {
    expect(isAbsolute(path)).toBe(true);
    expect(join(path, "..")).toBe(tmpdir());
    expect(await readFile(path)).toEqual(bytes);
    await writeFile(path, "original uploaded file");
    expect(await preparePromptImage({ ...image, path })).toBe(path);
    expect(await readFile(path, "utf8")).toBe("original uploaded file");
    await expect(preparePromptImage({ ...image, path: "relative.png" })).rejects.toThrow(
      "absolute",
    );
    await expect(preparePromptImage({ ...image, path: `${path}\n` })).rejects.toThrow(
      "control characters",
    );
  } finally {
    await unlink(path);
  }
});
