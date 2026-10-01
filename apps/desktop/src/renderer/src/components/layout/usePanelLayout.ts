import { useEffect, useRef, useState } from "react";

export const SIDEBAR_MIN_WIDTH = 240;
export const INSPECTOR_MIN_WIDTH = 320;
const MAIN_MIN_WIDTH = 480;

export function resolvePanelLayout({
  available,
  sidebarOpen,
  sidebarWidth,
  inspectorOpen,
  inspectorWidth,
}: {
  available: number;
  sidebarOpen: boolean;
  sidebarWidth: number;
  inspectorOpen: boolean;
  inspectorWidth: number;
}) {
  const space = available || Number.POSITIVE_INFINITY;
  const responsiveInspectorOpen = inspectorOpen && space >= MAIN_MIN_WIDTH + INSPECTOR_MIN_WIDTH;
  const rightWidth = Math.min(
    inspectorWidth,
    Math.max(INSPECTOR_MIN_WIDTH, space - MAIN_MIN_WIDTH),
  );
  const responsiveSidebarOpen =
    sidebarOpen &&
    space >= MAIN_MIN_WIDTH + SIDEBAR_MIN_WIDTH + (responsiveInspectorOpen ? rightWidth : 0);
  const sidebarMaxWidth = Math.max(
    SIDEBAR_MIN_WIDTH,
    space - MAIN_MIN_WIDTH - (responsiveInspectorOpen ? rightWidth : 0),
  );
  const leftWidth = Math.min(sidebarWidth, sidebarMaxWidth);
  const inspectorMaxWidth = Math.max(
    INSPECTOR_MIN_WIDTH,
    space - MAIN_MIN_WIDTH - (responsiveSidebarOpen ? leftWidth : 0),
  );
  return {
    responsiveInspectorOpen,
    responsiveSidebarOpen,
    sidebarMaxWidth,
    inspectorMaxWidth,
    sidebarWidth: leftWidth,
    inspectorWidth: Math.min(rightWidth, inspectorMaxWidth),
  };
}

export function usePanelLayout(hasWorkspace: boolean) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(290);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorWidth, setInspectorWidth] = useState(384);
  const [layoutWidth, setLayoutWidth] = useState(0);
  const layoutRowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = layoutRowRef.current;
    if (!row) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry?.contentRect.width) setLayoutWidth(entry.contentRect.width);
    });
    setLayoutWidth(row.clientWidth);
    observer.observe(row);
    return () => observer.disconnect();
  }, []);
  const requested = {
    available: layoutWidth,
    sidebarOpen,
    sidebarWidth,
    inspectorOpen: hasWorkspace && inspectorOpen,
    inspectorWidth,
  };
  function showSidebar(): void {
    setSidebarOpen(true);
    if (!resolvePanelLayout({ ...requested, sidebarOpen: true }).responsiveSidebarOpen) {
      setInspectorOpen(false);
    }
  }
  return {
    showSidebar,
    setSidebarOpen,
    setSidebarWidth,
    inspectorOpen,
    setInspectorOpen,
    setInspectorWidth,
    layoutRowRef,
    ...resolvePanelLayout(requested),
  };
}
