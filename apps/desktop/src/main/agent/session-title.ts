const DEFAULT_SESSION_TITLES = new Set(["Modus local agent", "New chat"]);
const MAX_TITLE_LENGTH = 42;

export function shouldReplaceSessionTitle(title: string | undefined): boolean {
  if (!title) {
    return true;
  }
  const trimmed = title.trim();
  return !trimmed || DEFAULT_SESSION_TITLES.has(trimmed);
}

export function deriveSessionTitle(prompt: string): string {
  const singleLine = prompt
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<context>[\s\S]*?<\/context>/gi, " ")
    .replace(/[@/][\w:-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!singleLine) {
    return "New chat";
  }

  const withoutPolitePrefix = singleLine
    .replace(/^(你好|您好|hello|hi|hey)[，,!！\s]+/i, "")
    .trim();
  const candidate = withoutPolitePrefix || singleLine;
  if (candidate.length <= MAX_TITLE_LENGTH) {
    return stripTrailingPunctuation(candidate);
  }

  return `${stripTrailingPunctuation(candidate.slice(0, MAX_TITLE_LENGTH).trim())}...`;
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[，。！？、,.!?;；:\s]+$/u, "");
}
