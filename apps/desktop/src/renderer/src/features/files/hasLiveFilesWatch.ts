/**
 * Live Files watch needs preload + main IPC. Renderer HMR can ship UI that
 * calls `files.watch` before Electron reloads the preload bridge — calling a
 * missing method white-screens the shell. Gate on presence first.
 */
export function hasLiveFilesWatch(files: {
  watch?: unknown;
  unwatch?: unknown;
  onChanged?: unknown;
}): boolean {
  return (
    typeof files.watch === "function" &&
    typeof files.unwatch === "function" &&
    typeof files.onChanged === "function"
  );
}
