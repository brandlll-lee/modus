/** 合并 className，过滤掉 falsy 值。受控使用，无需 tailwind-merge。 */
export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}
