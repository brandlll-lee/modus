import { describe, expect, it } from "vitest";
import { resolvePanelLayout } from "./usePanelLayout";

describe("panel layout", () => {
  const panels = { sidebarOpen: true, sidebarWidth: 290, inspectorOpen: true, inspectorWidth: 384 };
  it("opens the requested inspector on a compact desktop", () => {
    const layout = resolvePanelLayout({ ...panels, available: 1060 });
    expect(layout.responsiveInspectorOpen).toBe(true);
    expect(layout.responsiveSidebarOpen).toBe(false);
    expect(1060 - layout.inspectorWidth).toBeGreaterThanOrEqual(480);
  });
  it("restores both panels when there is room", () => {
    const layout = resolvePanelLayout({ ...panels, available: 1500 });
    expect(layout.responsiveInspectorOpen && layout.responsiveSidebarOpen).toBe(true);
    expect(layout.sidebarWidth).toBe(panels.sidebarWidth);
  });
  it("keeps the chat usable when panels cannot fit", () => {
    const layout = resolvePanelLayout({ ...panels, available: 700 });
    expect(layout.responsiveInspectorOpen || layout.responsiveSidebarOpen).toBe(false);
  });
  it("clamps an enlarged panel to the available space", () => {
    const layout = resolvePanelLayout({ ...panels, inspectorWidth: 1000, available: 1200 });
    expect(layout.inspectorWidth).toBe(720);
    expect(layout.responsiveSidebarOpen).toBe(false);
  });
});
