import { useEffect, useMemo, useRef, useState } from "react";
import type { SkillInfo } from "../../../../shared/contracts";

type UseComposerSlashInput = {
  value: string;
  cwd: string | undefined;
};

/**
 * A built-in command applies a fixed instruction to the prompt without needing
 * a skill file on disk. Selecting one rewrites the composer with its prefix so
 * the user can keep typing the target of the command.
 */
export type SlashCommand = {
  name: string;
  description: string;
  /** Text the composer is seeded with when the command is chosen. */
  prefix: string;
};

export const BUILTIN_COMMANDS: SlashCommand[] = [
  {
    name: "explain",
    description: "Explain without changing code",
    prefix: "Explain the following without changing any code:\n\n",
  },
  {
    name: "code-review",
    description: "Review code instead of editing it",
    prefix:
      "Review the code or diff below instead of editing it. Call out bugs, risks, and concrete improvements:\n\n",
  },
  {
    name: "write-tests",
    description: "Write or update tests for the target",
    prefix: "Write or update tests for the following. Cover edge cases and failure paths:\n\n",
  },
  {
    name: "find-bug",
    description: "Hunt down the root cause of a bug",
    prefix:
      "Investigate and find the root cause of this bug. Read the relevant code before proposing a fix:\n\n",
  },
];

export type SlashItem =
  | { kind: "skill"; key: string; name: string; description: string; skill: SkillInfo }
  | { kind: "command"; key: string; name: string; description: string; command: SlashCommand };

/** Active when the whole input is a single `/token` (no spaces yet). */
function getSlashQuery(value: string): { query: string } | undefined {
  const match = /^\/([A-Za-z0-9/_-]*)$/.exec(value);
  return match ? { query: match[1] ?? "" } : undefined;
}

export function useComposerSlash({ value, cwd }: UseComposerSlashInput) {
  const slash = useMemo(() => getSlashQuery(value), [value]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const loadedForCwd = useRef<string | undefined>(undefined);

  // Load skills the first time the slash menu opens for a workspace; refresh
  // when the workspace changes so newly added skills appear without a restart.
  useEffect(() => {
    if (!slash || !cwd) {
      return;
    }
    if (loadedForCwd.current === cwd) {
      return;
    }
    loadedForCwd.current = cwd;
    let cancelled = false;
    void window.modus.skills
      .list(cwd)
      .then((items: SkillInfo[]) => {
        if (!cancelled) {
          setSkills(items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSkills([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slash, cwd]);

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
      return BUILTIN_COMMANDS;
    }
    return BUILTIN_COMMANDS.filter(
      (command) =>
        command.name.toLowerCase().includes(query) ||
        command.description.toLowerCase().includes(query),
    );
  }, [query]);

  const items = useMemo<SlashItem[]>(
    () => [
      ...filteredSkills.map(
        (skill): SlashItem => ({
          kind: "skill",
          key: `skill:${skill.id}`,
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
    [filteredSkills, filteredCommands],
  );

  useEffect(() => {
    setActiveIndex(0);
  }, []);

  const isOpen = Boolean(slash && cwd) && items.length > 0;

  return {
    isOpen,
    items,
    activeIndex: Math.min(activeIndex, Math.max(0, items.length - 1)),
    setActiveIndex,
    skills,
  };
}
