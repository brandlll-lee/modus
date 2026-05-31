# Desktop Security Baseline

Modus renderer processes are intentionally unprivileged:

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- typed preload API only
- IPC sender validation in main handlers

This matches the Electron security guidance used for V0.1.0 M0.
