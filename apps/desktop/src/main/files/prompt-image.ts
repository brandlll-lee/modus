import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { PromptImageAttachment } from "../../shared/contracts";

export async function preparePromptImage(
  image: Pick<PromptImageAttachment, "data" | "mimeType" | "path">,
): Promise<string> {
  if (image.path) {
    if (!isAbsolute(image.path) || /\p{Cc}/u.test(image.path))
      throw new Error("Image path must be absolute and contain no control characters.");
    return image.path;
  }
  const extension = image.mimeType.slice("image/".length);
  const path = join(tmpdir(), `pi-clipboard-${randomUUID()}.${extension}`);
  await writeFile(path, Buffer.from(image.data, "base64"), { flag: "wx" });
  return path;
}
