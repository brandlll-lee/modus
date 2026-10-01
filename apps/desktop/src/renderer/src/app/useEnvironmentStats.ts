import { useEffect, useState } from "react";

export function useEnvironmentStats(cwd: string | undefined, running: boolean) {
  const [stats, setStats] = useState({ added: 0, removed: 0 });
  useEffect(() => {
    let active = true;
    // Re-read after the run settles to include its final edits.
    void running;
    if (!cwd) {
      setStats({ added: 0, removed: 0 });
      return;
    }
    void window.modus.diff
      .read({ cwd })
      .then(({ diff }) => {
        if (active)
          setStats(
            diff.split("\n").reduce(
              (total, line) => {
                if (line.startsWith("+") && !line.startsWith("+++")) total.added += 1;
                if (line.startsWith("-") && !line.startsWith("---")) total.removed += 1;
                return total;
              },
              { added: 0, removed: 0 },
            ),
          );
      })
      .catch(() => {
        if (active) setStats({ added: 0, removed: 0 });
      });
    return () => {
      active = false;
    };
  }, [cwd, running]);
  return stats;
}
