import { createContext, useContext } from "react";

export type MarkdownFileNav = {
  cwd: string | undefined;
  onOpenFile: ((path: string) => void) | undefined;
};

export const MarkdownFileNavContext = createContext<MarkdownFileNav>({
  cwd: undefined,
  onOpenFile: undefined,
});

export function useMarkdownFileNav(): MarkdownFileNav {
  return useContext(MarkdownFileNavContext);
}
