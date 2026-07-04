import {
  IconArrowLeft,
  IconArrowRight,
  IconDeviceDesktopCode,
  IconExternalLink,
  IconHistory,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconWorld,
  IconX,
} from "@tabler/icons-react";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  BrowserBounds,
  BrowserEvent,
  BrowserRecentInfo,
  BrowserTabInfo,
} from "../../../../shared/contracts";
import { useNativeSurfaceSuppressed } from "../../components/ui/nativeSurface";
import { Tooltip } from "../../components/ui/Tooltip";
import { cn } from "../../lib/cn";
import { computeBrowserViewBounds, sameBrowserBounds } from "./browserBounds";
import { DesignModeToggle } from "./DesignModeToggle";

type BrowserPanelProps = {
  active: boolean;
  workspaceId?: string | undefined;
};

const RECENTS_DRAWER_WIDTH = 260;

export function BrowserPanel({ active, workspaceId }: BrowserPanelProps) {
  const [tabs, setTabs] = useState<BrowserTabInfo[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | undefined>();
  const [address, setAddress] = useState("");
  const [pendingNavigation, setPendingNavigation] = useState(false);
  const [designTabs, setDesignTabs] = useState<Set<string>>(() => new Set());
  const [recentsOpen, setRecentsOpen] = useState(false);
  const [recents, setRecents] = useState<BrowserRecentInfo[]>([]);
  const [recentQuery, setRecentQuery] = useState("");

  const rootRef = useRef<HTMLDivElement | null>(null);
  const addressInputRef = useRef<HTMLInputElement | null>(null);
  const syncInFlightRef = useRef(false);
  const activeTabIdRef = useRef<string | undefined>(undefined);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs.at(0),
    [activeTabId, tabs],
  );
  const activeId = activeTab?.id;
  const activeUrl = activeTab?.url ?? "";
  const activePageTabId =
    activeTab && activeUrl && activeUrl !== "about:blank" ? activeTab.id : undefined;
  const isLoading = pendingNavigation || Boolean(activeTab?.loading);
  const designOn = Boolean(activeId && designTabs.has(activeId));

  const designOnRef = useRef(false);
  designOnRef.current = designOn;

  useEffect(() => {
    activeTabIdRef.current = activeId;
  }, [activeId]);

  const toggleDesign = useCallback(() => {
    const tabId = activeTabIdRef.current;
    if (!tabId) {
      return;
    }
    const next = !designOnRef.current;
    // Optimistic; the browser.design-mode-changed event reconciles the truth.
    setDesignTabs((prev) => {
      const set = new Set(prev);
      if (next) {
        set.add(tabId);
      } else {
        set.delete(tabId);
      }
      return set;
    });
    void window.modus.browser.setDesignMode({ tabId, enabled: next, theme: resolveDesignTheme() });
  }, []);

  const refreshRecents = useCallback(async (): Promise<void> => {
    if (!workspaceId) {
      setRecents([]);
      return;
    }
    setRecents(await window.modus.browser.listRecents({ workspaceId }));
  }, [workspaceId]);

  const syncTabs = useCallback(async () => {
    if (!workspaceId) {
      setTabs([]);
      setActiveTabId(undefined);
      return;
    }
    if (syncInFlightRef.current) {
      return;
    }
    syncInFlightRef.current = true;
    try {
      const nextTabs = await window.modus.browser.listTabs({ workspaceId });
      setTabs(nextTabs);
      setActiveTabId((current) =>
        current && nextTabs.some((tab: BrowserTabInfo) => tab.id === current)
          ? current
          : nextTabs.at(-1)?.id,
      );
    } finally {
      syncInFlightRef.current = false;
    }
  }, [workspaceId]);

  // Load known tabs without creating a blank browser view; the empty state owns
  // first-run until the user enters a URL or presses Ctrl+T.
  useEffect(() => {
    if (active && tabs.length === 0) {
      void syncTabs();
    }
  }, [active, syncTabs, tabs.length]);

  const focusAddress = useCallback(() => {
    const input = addressInputRef.current;
    if (input) {
      input.focus();
      input.select();
    }
  }, []);

  useEffect(() => {
    return window.modus.browser.onEvent((event: BrowserEvent) => {
      if (!workspaceId) {
        return;
      }

      if (event.type === "browser.created" && event.tab.workspaceId === workspaceId) {
        setTabs((current) => upsertTab(current, event.tab));
        setActiveTabId(event.tab.id);
        return;
      }

      if (event.type === "browser.updated" && event.tab.workspaceId === workspaceId) {
        setTabs((current) => upsertTab(current, event.tab));
        if (event.tab.id === activeTabIdRef.current && !event.tab.loading) {
          setPendingNavigation(false);
        }
        if (recentsOpen && /^https?:/i.test(event.tab.url)) {
          void refreshRecents();
        }
        return;
      }

      if (event.type === "browser.closed" && event.workspaceId === workspaceId) {
        setTabs((current) => {
          const remaining = current.filter((tab) => tab.id !== event.tabId);
          setActiveTabId((currentTabId) =>
            currentTabId === event.tabId ? remaining.at(-1)?.id : currentTabId,
          );
          return remaining;
        });
        return;
      }

      if (event.type === "browser.selected" && event.workspaceId === workspaceId) {
        setActiveTabId(event.tabId);
        return;
      }

      if (event.type === "browser.shortcut" && event.workspaceId === workspaceId) {
        if (event.shortcut === "focus-address") {
          focusAddress();
        } else if (event.shortcut === "toggle-design") {
          toggleDesign();
        }
      }

      if (event.type === "browser.design-mode-changed" && event.workspaceId === workspaceId) {
        setDesignTabs((prev) => {
          const set = new Set(prev);
          if (event.enabled) {
            set.add(event.tabId);
          } else {
            set.delete(event.tabId);
          }
          return set;
        });
      }
    });
  }, [workspaceId, focusAddress, recentsOpen, refreshRecents, toggleDesign]);

  useEffect(() => {
    if (active && recentsOpen) {
      void refreshRecents();
    }
  }, [active, recentsOpen, refreshRecents]);

  // Address bar mirrors the active tab unless the user is editing it.
  useEffect(() => {
    if (document.activeElement !== addressInputRef.current) {
      setAddress(activeUrl === "about:blank" ? "" : activeUrl);
    }
  }, [activeUrl]);

  const createTab = useCallback(async (): Promise<void> => {
    if (!workspaceId) {
      return;
    }
    const tab = await window.modus.browser.createTab({ workspaceId });
    setTabs((current) => upsertTab(current, tab));
    setActiveTabId(tab.id);
    window.requestAnimationFrame(focusAddress);
  }, [workspaceId, focusAddress]);

  const selectTab = useCallback(async (tabId: string): Promise<void> => {
    const tab = await window.modus.browser.selectTab({ tabId });
    setTabs((current) => upsertTab(current, tab));
    setActiveTabId(tab.id);
  }, []);

  const closeTab = useCallback(async (tabId: string): Promise<void> => {
    await window.modus.browser.closeTab({ tabId });
  }, []);

  const openRecent = useCallback(
    async (recent: BrowserRecentInfo): Promise<void> => {
      if (!workspaceId) {
        return;
      }
      setPendingNavigation(true);
      try {
        const tab = await window.modus.browser.navigate({
          ...(activeTab ? { tabId: activeTab.id } : { workspaceId }),
          url: recent.url,
        });
        setTabs((current) => upsertTab(current, tab));
        setActiveTabId(tab.id);
        setRecentsOpen(false);
      } finally {
        setPendingNavigation(false);
      }
    },
    [activeTab, workspaceId],
  );

  const deleteRecent = useCallback(
    async (recent: BrowserRecentInfo): Promise<void> => {
      await window.modus.browser.deleteRecent({ id: recent.id });
      await refreshRecents();
    },
    [refreshRecents],
  );

  async function submitAddress(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!address.trim() || (!activeTab && !workspaceId)) {
      return;
    }
    setPendingNavigation(true);
    try {
      const tab = await window.modus.browser.navigate({
        ...(activeTab ? { tabId: activeTab.id } : {}),
        ...(workspaceId ? { workspaceId } : {}),
        url: address,
      });
      setTabs((current) => upsertTab(current, tab));
      setActiveTabId(tab.id);
      addressInputRef.current?.blur();
    } finally {
      setPendingNavigation(false);
    }
  }

  function reloadActiveTab(): void {
    if (!activeTab) {
      return;
    }
    setPendingNavigation(true);
    void window.modus.browser
      .reload({ tabId: activeTab.id })
      .then((tab: BrowserTabInfo) => {
        setTabs((current) => upsertTab(current, tab));
        if (!tab.loading) {
          setPendingNavigation(false);
        }
      })
      .catch(() => setPendingNavigation(false));
  }

  // Browser shortcuts while focus is in the panel chrome (the page itself is
  // covered by the main-process before-input-event hook).
  useEffect(() => {
    if (!active) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      const root = rootRef.current;
      if (!root || !(event.target instanceof Node) || !root.contains(event.target)) {
        return;
      }
      if (event.key === "Escape" && recentsOpen) {
        setRecentsOpen(false);
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const chord = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const tab = tabs.find((entry) => entry.id === activeTabIdRef.current) ?? tabs.at(0);

      if (key === "f12" && tab) {
        void window.modus.browser.toggleDevtools({ tabId: tab.id });
      } else if ((key === "f5" || (chord && key === "r")) && tab) {
        setPendingNavigation(true);
        void window.modus.browser
          .reload({ tabId: tab.id })
          .then((nextTab: BrowserTabInfo) => {
            setTabs((current) => upsertTab(current, nextTab));
            if (!nextTab.loading) {
              setPendingNavigation(false);
            }
          })
          .catch(() => setPendingNavigation(false));
      } else if (chord && key === "t") {
        void createTab();
      } else if (chord && key === "w" && tab) {
        void closeTab(tab.id);
      } else if (chord && key === "l") {
        focusAddress();
      } else if (chord && event.shiftKey && key === "d") {
        toggleDesign();
      } else {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [active, tabs, createTab, closeTab, focusAddress, recentsOpen, toggleDesign]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas" ref={rootRef}>
      <BrowserTabRail
        activeTabId={activeTab?.id}
        onCloseTab={(tabId) => void closeTab(tabId)}
        onCreateTab={() => void createTab()}
        onSelectTab={(tabId) => void selectTab(tabId)}
        tabs={tabs}
      />
      <div className="toolbar-row flex shrink-0 items-center gap-1 px-3">
        <BrowserIconButton
          active={recentsOpen}
          disabled={!workspaceId}
          label="Recents"
          onClick={() => setRecentsOpen((open) => !open)}
        >
          <IconHistory size={18} stroke={1.7} />
        </BrowserIconButton>
        <BrowserIconButton
          disabled={!activeTab?.canGoBack}
          label="Back"
          onClick={() => activeTab && void window.modus.browser.back({ tabId: activeTab.id })}
        >
          <IconArrowLeft size={18} stroke={1.7} />
        </BrowserIconButton>
        <BrowserIconButton
          disabled={!activeTab?.canGoForward}
          label="Forward"
          onClick={() => activeTab && void window.modus.browser.forward({ tabId: activeTab.id })}
        >
          <IconArrowRight size={18} stroke={1.7} />
        </BrowserIconButton>
        <BrowserIconButton disabled={!activeTab} label="Reload (F5)" onClick={reloadActiveTab}>
          <IconRefresh className={cn(isLoading && "animate-spin")} size={18} stroke={1.7} />
        </BrowserIconButton>
        <form className="mx-3 min-w-0 flex-1" onSubmit={(event) => void submitAddress(event)}>
          <input
            className="h-8 w-full rounded-md border border-transparent bg-transparent px-3 text-center text-fg text-sm outline-none transition-colors placeholder:text-fg-muted hover:bg-hover focus:border-hairline focus:bg-hover focus:text-left"
            onChange={(event) => setAddress(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setAddress(activeUrl === "about:blank" ? "" : activeUrl);
                event.currentTarget.blur();
              }
            }}
            placeholder="输入 URL"
            ref={addressInputRef}
            spellCheck={false}
            value={address}
          />
        </form>
        <DesignModeToggle active={designOn} disabled={!activePageTabId} onToggle={toggleDesign} />
        <BrowserIconButton
          active={Boolean(activeTab?.devtoolsOpen)}
          disabled={!activePageTabId}
          label="DevTools (F12)"
          onClick={() =>
            activeTab && void window.modus.browser.toggleDevtools({ tabId: activeTab.id })
          }
        >
          <IconDeviceDesktopCode size={18} stroke={1.7} />
        </BrowserIconButton>
        <BrowserIconButton
          disabled={!activePageTabId || !/^https?:/i.test(activeUrl)}
          label="Open in external browser"
          onClick={() =>
            activeTab && void window.modus.browser.openExternal({ tabId: activeTab.id })
          }
        >
          <IconExternalLink size={18} stroke={1.7} />
        </BrowserIconButton>
      </div>
      <BrowserViewport
        active={active}
        leftInset={recentsOpen ? RECENTS_DRAWER_WIDTH : 0}
        tabId={activePageTabId}
      >
        {recentsOpen ? (
          <BrowserRecentsDrawer
            onDelete={(recent) => void deleteRecent(recent)}
            onOpen={(recent) => void openRecent(recent)}
            onQueryChange={setRecentQuery}
            query={recentQuery}
            recents={recents}
          />
        ) : null}
      </BrowserViewport>
    </div>
  );
}

function BrowserTabRail({
  activeTabId,
  onCloseTab,
  onCreateTab,
  onSelectTab,
  tabs,
}: {
  activeTabId?: string | undefined;
  onCloseTab: (tabId: string) => void;
  onCreateTab: () => void;
  onSelectTab: (tabId: string) => void;
  tabs: BrowserTabInfo[];
}) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 px-3 pt-1">
      <div className="scroll-thin flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {tabs.length === 0 ? (
          <button
            className="flex h-8 max-w-52 shrink-0 cursor-default items-center gap-2 rounded-md bg-active px-3 text-fg text-sm"
            disabled
            type="button"
          >
            <IconWorld className="toolbar-icon shrink-0" size={18} stroke={1.7} />
            <span className="truncate">新页面</span>
          </button>
        ) : (
          tabs.map((tab) => {
            const active = tab.id === activeTabId;
            const label = tab.title?.trim() || "新页面";
            return (
              <div
                className={cn(
                  "group flex h-8 max-w-52 shrink-0 items-center rounded-md pr-1 transition-colors",
                  active ? "bg-active text-fg" : "text-fg-muted hover:bg-hover hover:text-fg",
                )}
                key={tab.id}
              >
                <button
                  className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-l-md px-3 text-left"
                  onClick={() => onSelectTab(tab.id)}
                  title={label}
                  type="button"
                >
                  <IconWorld className="toolbar-icon shrink-0" size={18} stroke={1.7} />
                  <span className="truncate">{label}</span>
                </button>
                <button
                  aria-label="关闭页面"
                  className="flex size-5 shrink-0 items-center justify-center rounded-full bg-fg text-canvas opacity-0 transition-opacity hover:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  type="button"
                >
                  <IconX size={12} stroke={2.2} />
                </button>
              </div>
            );
          })
        )}
      </div>
      <BrowserIconButton label="新页面" onClick={onCreateTab}>
        <IconPlus size={18} stroke={1.7} />
      </BrowserIconButton>
    </div>
  );
}

function BrowserViewport({
  active,
  children,
  leftInset = 0,
  tabId,
}: {
  active: boolean;
  children?: ReactNode;
  leftInset?: number;
  tabId?: string | undefined;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const leftInsetRef = useRef(leftInset);
  const syncBoundsRef = useRef<(() => void) | null>(null);
  leftInsetRef.current = leftInset;
  // A full-screen DOM overlay (e.g. the image lightbox) is on top: native views
  // paint above the DOM, so the embedded browser must hide until it closes.
  const suppressed = useNativeSurfaceSuppressed();

  useEffect(() => {
    const host = hostRef.current;
    if (!active || !tabId || !host) {
      syncBoundsRef.current = null;
      return undefined;
    }

    if (suppressed) {
      syncBoundsRef.current = null;
      // Hide now; when suppression lifts this effect re-runs and re-shows the
      // view at freshly measured bounds. No observer while hidden.
      void window.modus.browser.hide({ tabId });
      return undefined;
    }

    let disposed = false;
    let lastBounds: BrowserBounds | null = null;
    const boundsForHost = (): BrowserBounds => {
      const rect = host.getBoundingClientRect();
      const inset = leftInsetRef.current;
      return computeBrowserViewBounds({
        left: rect.left + inset,
        top: rect.top,
        width: Math.max(0, rect.width - inset),
        height: rect.height,
      });
    };

    // Initial show: attach + make visible + force bounds, unconditionally.
    // (Stale cached bounds were one root cause of the black-border bug.)
    const initialBounds = boundsForHost();
    if (initialBounds.width > 0 && initialBounds.height > 0) {
      lastBounds = initialBounds;
      void window.modus.browser.show({ tabId, bounds: initialBounds });
    }

    const syncBounds = (): void => {
      if (disposed) {
        return;
      }
      const bounds = boundsForHost();
      if (bounds.width === 0 || bounds.height === 0) {
        return;
      }
      if (lastBounds === null) {
        // First non-empty measurement (host was 0-sized at mount).
        lastBounds = bounds;
        void window.modus.browser.show({ tabId, bounds });
        return;
      }
      if (!sameBrowserBounds(lastBounds, bounds)) {
        lastBounds = bounds;
        void window.modus.browser.setBounds({ tabId, bounds });
      }
    };

    // ResizeObserver covers every real geometry change (panel drag-resize via
    // the Inspector's motion value, find bar opening, window maximize): the
    // host's size always changes with them. The old per-frame rAF loop is gone.
    const observer = new ResizeObserver(syncBounds);
    observer.observe(host);
    window.addEventListener("resize", syncBounds);
    syncBoundsRef.current = syncBounds;

    return () => {
      disposed = true;
      syncBoundsRef.current = null;
      observer.disconnect();
      window.removeEventListener("resize", syncBounds);
      void window.modus.browser.hide({ tabId });
    };
  }, [active, tabId, suppressed]);

  useLayoutEffect(() => {
    syncBoundsRef.current?.();
  }, [leftInset]);

  return (
    <div className="relative min-h-0 flex-1 bg-canvas">
      <div className="absolute inset-0" ref={hostRef} />
      {!tabId ? (
        <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
          <IconWorld className="toolbar-icon" size={70} stroke={1.35} />
          <div className="space-y-1">
            <div className="font-medium text-fg text-sm">开始浏览</div>
            <div className="text-fg-muted text-xs">输入 URL 以打开页面</div>
          </div>
        </div>
      ) : null}
      {children}
    </div>
  );
}

function BrowserRecentsDrawer({
  onDelete,
  onOpen,
  onQueryChange,
  query,
  recents,
}: {
  onDelete: (recent: BrowserRecentInfo) => void;
  onOpen: (recent: BrowserRecentInfo) => void;
  onQueryChange: (query: string) => void;
  query: string;
  recents: BrowserRecentInfo[];
}) {
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return recents;
    }
    return recents.filter((recent) =>
      `${recent.title} ${recent.url}`.toLowerCase().includes(needle),
    );
  }, [query, recents]);
  const today = new Date().toDateString();
  const todayItems = filtered.filter(
    (recent) => new Date(recent.lastOpenedAt).toDateString() === today,
  );
  const earlierItems = filtered.filter(
    (recent) => new Date(recent.lastOpenedAt).toDateString() !== today,
  );

  return (
    <div
      className="absolute inset-y-0 left-0 z-10 flex flex-col border-hairline border-r bg-canvas/95 p-3 shadow-xl backdrop-blur"
      style={{ width: RECENTS_DRAWER_WIDTH }}
    >
      <input
        className="h-8 w-full rounded-md border border-hairline bg-transparent px-2 text-fg text-sm outline-none placeholder:text-fg-muted focus:border-hairline-strong"
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="Search"
        value={query}
      />
      <div className="scroll-thin mt-4 min-h-0 flex-1 overflow-y-auto">
        <RecentSection items={todayItems} label="Today" onDelete={onDelete} onOpen={onOpen} />
        <RecentSection items={earlierItems} label="Earlier" onDelete={onDelete} onOpen={onOpen} />
        {filtered.length === 0 ? (
          <div className="px-1 py-6 text-fg-muted text-sm">No recent pages</div>
        ) : null}
      </div>
    </div>
  );
}

function RecentSection({
  items,
  label,
  onDelete,
  onOpen,
}: {
  items: BrowserRecentInfo[];
  label: string;
  onDelete: (recent: BrowserRecentInfo) => void;
  onOpen: (recent: BrowserRecentInfo) => void;
}) {
  if (items.length === 0) {
    return null;
  }
  return (
    <section className="mb-4">
      <div className="mb-2 px-1 font-medium text-fg-muted text-xs">{label}</div>
      <div className="space-y-1">
        {items.map((recent) => (
          <RecentItem key={recent.id} onDelete={onDelete} onOpen={onOpen} recent={recent} />
        ))}
      </div>
    </section>
  );
}

function RecentItem({
  onDelete,
  onOpen,
  recent,
}: {
  onDelete: (recent: BrowserRecentInfo) => void;
  onOpen: (recent: BrowserRecentInfo) => void;
  recent: BrowserRecentInfo;
}) {
  return (
    <div className="group flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-fg-muted hover:bg-hover hover:text-fg">
      <button
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        onClick={() => onOpen(recent)}
        title={recent.url}
        type="button"
      >
        {recent.favicon ? (
          <img alt="" className="size-4 shrink-0 rounded-sm" src={recent.favicon} />
        ) : (
          <IconWorld className="toolbar-icon shrink-0" size={16} stroke={1.7} />
        )}
        <span className="min-w-0 flex-1 truncate text-sm">{recent.title || recent.url}</span>
        <span className="shrink-0 text-fg-faint text-xs">{formatRecentTime(recent.lastOpenedAt)}</span>
      </button>
      <button
        aria-label="Remove recent page"
        className="flex size-5 shrink-0 items-center justify-center rounded text-fg-muted opacity-0 hover:bg-active hover:text-fg group-hover:opacity-100 focus-visible:opacity-100"
        onClick={(event) => {
          event.stopPropagation();
          onDelete(recent);
        }}
        type="button"
      >
        <IconTrash size={13} stroke={1.8} />
      </button>
    </div>
  );
}

function formatRecentTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
}

function BrowserIconButton({
  active = false,
  children,
  disabled = false,
  label,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick?: () => void;
}) {
  return (
    <Tooltip content={label} side="bottom">
      <button
        aria-label={label}
        className={cn(
          "toolbar-icon-button flex shrink-0 items-center justify-center rounded-md transition-colors hover:bg-hover",
          active && "bg-active",
          disabled && "cursor-not-allowed opacity-35 hover:bg-transparent",
        )}
        data-active={active}
        disabled={disabled}
        onClick={onClick}
        type="button"
      >
        {children}
      </button>
    </Tooltip>
  );
}

/**
 * Resolve Modus's current theme tokens (light or dark) into the value set the
 * in-page Design Mode overlay needs, so the overlay always matches the app's
 * own look regardless of the page it's drawn over.
 */
function resolveDesignTheme() {
  const styles = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string): string =>
    styles.getPropertyValue(name).trim() || fallback;
  return {
    accent: token("--color-focus-ring", "#853ff4"),
    accentSoft: token("--color-focus-ring-soft", "#b388ff"),
    accentContrast: "#ffffff",
    surface: token("--color-surface", "#1c1c1d"),
    elevated: token("--color-elevated", "#232325"),
    fg: token("--color-fg", "#e4e4e3"),
    fgSubtle: token("--color-fg-subtle", "#8a8a87"),
    fontFamily: token("--font-sans", '"Inter Variable", "Inter", system-ui, sans-serif'),
    border: token("--color-hairline-strong", "rgba(255,255,255,0.08)"),
    shadow: "rgba(0,0,0,0.5)",
    fill: "rgba(133, 63, 244, 0.12)",
  };
}

function upsertTab(tabs: BrowserTabInfo[], tab: BrowserTabInfo): BrowserTabInfo[] {
  const exists = tabs.some((item) => item.id === tab.id);
  if (!exists) {
    return [...tabs, tab];
  }
  return tabs.map((item) => (item.id === tab.id ? tab : item));
}
