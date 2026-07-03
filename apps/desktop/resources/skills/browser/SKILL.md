---
name: browser
description: Use when controlling the Modus in-app browser for navigation, page inspection, forms, search, screenshots, or browser-state verification with raw Chrome DevTools Protocol.
allow-implicit-invocation: true
allowed-tools:
  - browser_tabs
  - browser_cdp
  - browser_events
  - browser_screenshot
---

# Browser

Use the Modus browser as a real page surface. Keep the tool layer low-level: tabs, raw CDP commands, event drain, and screenshots.

## Workflow

1. Start with `browser_tabs` using `action: "list"`. Create a tab with `action: "new"` when no suitable tab exists.
2. Use `browser_cdp` with official Chrome DevTools Protocol `method` and `params`.
3. After navigation or mutation, verify with `browser_events` or `browser_screenshot`.
4. If the page state is unclear, inspect first. Do not guess.

## CDP Patterns

- Navigate: `Page.navigate` with `{ "url": "https://example.com" }`.
- Read page state: `Runtime.evaluate` with `returnByValue: true` and, when useful, `awaitPromise: true`.
- Locate elements semantically: `DOM.getDocument`, then `DOM.querySelector` or `DOM.querySelectorAll`.
- Click only after locating or visually confirming the target: `Input.dispatchMouseEvent` for press and release.
- Type text: focus the element, then use `Input.insertText`; submit with `Input.dispatchKeyEvent` when needed.

## Rules

- Do not look for Modus wrapper tools such as `browser_click`, `browser_fill`, or `browser_scroll`.
- Prefer DOM or `Runtime.evaluate` for stable targeting. Use coordinates only after a screenshot or element box confirms them.
- When a command fails, drain events or capture a screenshot, then re-locate the target from current state.
- Keep a short note in your answer about what page state you verified.
