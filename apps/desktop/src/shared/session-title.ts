const DEFAULT_SESSION_TITLES = new Set(["Modus local agent", "New chat"]);
const MAX_TITLE_LENGTH = 50;

export function shouldReplaceSessionTitle(title: string | undefined): boolean {
  if (!title) {
    return true;
  }
  const trimmed = title.trim();
  return !trimmed || DEFAULT_SESSION_TITLES.has(trimmed);
}

export function deriveSessionTitle(prompt: string): string {
  const title = prompt.replace(/\s+/g, " ").trim();
  return title ? title.slice(0, MAX_TITLE_LENGTH).trim() : "New chat";
}
