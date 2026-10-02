# Desktop Security

The renderer runs with nodeIntegration disabled, contextIsolation enabled, and sandbox enabled. A typed preload bridge exposes GUI operations. Main-process IPC handlers validate the sender and input.

PI owns Agent tool execution and project trust. Users can install PI extensions for additional tool policies. Native extension select, confirm, input, and editor requests use desktop dialogs.

The main process owns local file access, Git operations, browser tabs, model access, session files, and terminal processes. The Rust sidecar owns PTY spawning and terminal IO. Browser sessions use separate workspace partitions and restrict permissions and navigation protocols.
