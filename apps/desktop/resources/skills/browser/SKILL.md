---
name: browser
description: Use when controlling the Modus in-app browser for navigation, page inspection, forms, search, screenshots, or browser-state verification with raw Chrome DevTools Protocol.
allow-implicit-invocation: true
allowed-tools:
  - browser_tabs
  - browser_cdp
  - browser_events
  - browser_snapshot
  - browser_screenshot
---

# Browser

Use the Modus browser as a real page surface. Keep the tool layer low-level: tabs, raw CDP commands, event drain, accessibility snapshots, and screenshots.

## Workflow

1. Start with `browser_tabs` using `action: "list"`. Create a tab with `action: "new"` when no suitable tab exists.
2. Use `browser_cdp` with official Chrome DevTools Protocol `method` and `params`; do not invent wrapper tools.
3. After navigation, read page facts with `browser_cdp` or `browser_snapshot` before screenshots: title, URL, readyState, visible text, accessibility state, or DOM.
4. After mutation, verify with a fresh `browser_snapshot`, `browser_events`, or page facts. Use `browser_screenshot` only when pixels or coordinate calibration matter.
5. If the page state is unclear, inspect with `browser_cdp` first. Do not guess.

## CDP Patterns

- Navigate: `Page.navigate` with `{ "url": "https://example.com" }`.
- Read page state: `Runtime.evaluate` with `returnByValue: true` and, when useful, `awaitPromise: true`.
- Read non-visual structure: `browser_snapshot` for the current accessibility tree, roles, names, and actionable refs.
- Wait for page state: poll `document.readyState`, URL, elements, or drained events. Do not use shell sleeps for browser waits.
- Batch extraction/filtering in one `Runtime.evaluate` when the page has lists or search results.
- Locate elements semantically: `DOM.getDocument`, then `DOM.querySelector` or `DOM.querySelectorAll`.
- Click only after locating or visually confirming the target: `Input.dispatchMouseEvent` for press and release.
- CDP mouse `x`/`y` are CSS pixels. If you measure from a screenshot image, use the screenshot-reported CSS size, image size, and `devicePixelRatio`; convert image pixels to CSS pixels before clicking.
- Type text: focus the element, then use `Input.insertText`; submit with `Input.dispatchKeyEvent` when needed.

## Rules

- Do not look for Modus wrapper tools such as `browser_click`, `browser_fill`, `browser_scroll`, or site-specific helpers.
- Prefer DOM or `Runtime.evaluate` for stable targeting. Use coordinates only after a screenshot or element box confirms them.
- After coordinate clicks, verify the state changed with at least two fresh signals such as `browser_snapshot`, DOM/page facts, or `browser_events`. A successful CDP send (`{}`) only means the event was dispatched.
- A single disappearing selector is not enough to declare success. Confirm the user-visible or task-relevant state changed.
- Treat `browser_snapshot` as the primary text-model view of the page. Treat `browser_screenshot` as visual verification or coordinate calibration, not the primary way to understand text pages.
- CDP events are read through `browser_events`; event names like `Page.loadEventFired` are not CDP commands.
- When a command fails, drain events or capture a fresh snapshot, then re-locate the target from current state.
- Keep a short note in your answer about what page state you verified.
