export function subagentColor(id: string): string {
  const colors = ["#e05252", "#d97b2b", "#18a058", "#168acd", "#8b5cf6", "#c026d3"];
  let hash = 0;
  for (const char of id) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return colors[hash % colors.length] ?? "#863ff5";
}
