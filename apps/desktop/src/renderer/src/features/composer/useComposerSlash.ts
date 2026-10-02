import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { SkillInfo } from "../../../../shared/contracts";

type UseComposerSlashInput = {
  sessionId?: string | undefined;
  value: string;
  cwd: string | undefined;
  actions: SlashActionItem[];
};

export type SlashActionItem = Omit<SlashCommand, "prefix"> & {
  kind: "action";
  key: string;
  disabled?: boolean;
  leading: ReactNode;
  run(): Promise<void>;
};

export type SlashCommand = {
  name: string;
  description: string;
  /** Text the composer is seeded with when the command is chosen. */
  prefix: string;
};

export type SlashItem =
  | SlashActionItem
  | { kind: "skill"; key: string; name: string; description: string; skill: SkillInfo }
  | { kind: "command"; key: string; name: string; description: string; command: SlashCommand };

/** Active when the text immediately before the caret ends in `/token`. */
export function getSlashQuery(value: string): { start: number; query: string } | undefined {
  const match = /(?:^|\s)\/([A-Za-z0-9/_-]*)$/.exec(value);
  if (!match || match.index === undefined) {
    return undefined;
  }
  return { start: match.index + match[0].indexOf("/"), query: match[1] ?? "" };
}

export function useComposerSlash({ value, cwd, sessionId, actions }: UseComposerSlashInput) {
  const slash = useMemo(() => getSlashQuery(value), [value]);
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const menuRequested = Boolean(slash);

  useEffect(() => {
    if (!menuRequested || !cwd || !sessionId) {
      setSkills([]);
      setCommands([]);
      return;
    }
    let active = true;
    let generation = 0;
    async function refresh(): Promise<void> {
      const request = ++generation;
      try {
        const [items, nativeCommands] = await Promise.all([
          window.modus.skills.list(sessionId as string),
          window.modus.agent.commands(sessionId as string),
        ]);
        if (active && request === generation) {
          setSkills(items.skills);
          setCommands(
            nativeCommands.map((command) => ({ ...command, prefix: `/${command.name} ` })),
          );
        }
      } catch {
        if (active && request === generation) {
          setSkills([]);
          setCommands([]);
        }
      }
    }
    void refresh();
    const unsubscribe = window.modus.skills.onChanged((changedCwd: string) => {
      if (changedCwd === cwd) void refresh();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [menuRequested, cwd, sessionId]);

  const query = slash?.query.toLowerCase() ?? "";

  const filteredSkills = useMemo(() => {
    if (!query) {
      return skills;
    }
    return skills.filter(
      (skill) =>
        skill.name.toLowerCase().includes(query) || skill.description.toLowerCase().includes(query),
    );
  }, [skills, query]);

  const filteredCommands = useMemo(() => {
    if (!query) {
      return commands;
    }
    return commands.filter(
      (command) =>
        command.name.toLowerCase().includes(query) ||
        command.description.toLowerCase().includes(query),
    );
  }, [query, commands]);

  const items = useMemo<SlashItem[]>(
    () => [
      ...actions.filter(
        (action) =>
          !query ||
          action.name.toLowerCase().includes(query) ||
          action.description.toLowerCase().includes(query),
      ),
      ...filteredSkills.map(
        (skill): SlashItem => ({
          kind: "skill",
          key: `skill:${skill.path}`,
          name: skill.name,
          description: skill.description,
          skill,
        }),
      ),
      ...filteredCommands.map(
        (command): SlashItem => ({
          kind: "command",
          key: `command:${command.name}`,
          name: command.name,
          description: command.description,
          command,
        }),
      ),
    ],
    [actions, filteredSkills, filteredCommands, query],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: A new query resets the highlighted result.
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const isOpen = Boolean(slash && cwd) && items.length > 0;

  return {
    isOpen,
    query: slash?.query,
    items,
    activeIndex: Math.min(activeIndex, Math.max(0, items.length - 1)),
    setActiveIndex,
  };
}
