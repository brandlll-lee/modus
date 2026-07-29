/**
 * Align LLM math fences with remark-math / @streamdown/math's contract.
 *
 * The pipeline only parses `$…$` / `$$…$$`. Models often emit LaTeX-style
 * `\(...\)` / `\[…\]`; without normalization those never become math nodes, and
 * CommonMark further strips the backslashes — leaving bare `\mathrm` / `\frac`.
 *
 * Fenced code blocks are left untouched so examples of TeX delimiters stay literal.
 */
export function normalizeMathDelimiters(markdown: string): string {
  if (!markdown.includes("\\(") && !markdown.includes("\\[")) {
    return markdown;
  }
  return markdown
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g)
    .map((part, index) => {
      // Odd segments are fenced code (kept by the capturing split).
      if (index % 2 === 1) return part;
      return part
        .replace(/\\\[([\s\S]*?)\\\]/g, (_match, body: string) => `$$\n${body.trim()}\n$$`)
        .replace(/\\\(([\s\S]*?)\\\)/g, (_match, body: string) => `$${body}$`);
    })
    .join("");
}
