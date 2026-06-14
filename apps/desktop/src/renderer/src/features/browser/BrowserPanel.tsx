import {
  IconArrowLeft,
  IconArrowRight,
  IconChevronDown,
  IconChevronUp,
  IconDeviceDesktopCode,
  IconExternalLink,
  IconLoader2,
  IconLock,
  IconLockOpen,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconWorld,
  IconX,
} from "@tabler/icons-react";
import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { BrowserBounds, BrowserEvent, BrowserTabInfo } from "../../../../shared/contracts";
import { useNativeSurfaceSuppressed } from "../../components/ui/nativeSurface";
import { Tooltip } from "../../components/ui/Tooltip";
import { cn } from "../../lib/cn";
import { computeBrowserViewBounds, sameBrowserBounds } from "./browserBounds";
import { DesignModeToggle } from "./DesignModeToggle";

type BrowserPanelProps = {
  active: boolean;
  workspaceId?: string | undefined;
};

type FindResult = {
  matches: number;
  ordinal: number;
};

export function BrowserPanel({ active, workspaceId }: BrowserPanelProps) {
  const [tabs, setTabs] = useState<BrowserTabInfo[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | undefined>();
  const [address, setAddress] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findResult, setFindResult] = useState<FindResult>({ matches: 0, ordinal: 0 });
  const [designTabs, setDesignTabs] = useState<Set<string>>(() => new Set());

  const rootRef = useRef<HTMLDivElement | null>(null);
  const addressInputRef = useRef<HTMLInputElement | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const syncInFlightRef = useRef(false);
  const activeTabIdRef = useRef<string | undefined>(undefined);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs.at(0),
    [activeTabId, tabs],
  );
  const activeId = activeTab?.id;
  const activeUrl = activeTab?.url ?? "";
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
      if (nextTabs.length === 0) {
        const tab = await window.modus.browser.createTab({ workspaceId });
        setTabs([tab]);
        setActiveTabId(tab.id);
        return;
      }
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

  // Initial load + auto-recover an empty strip (e.g. after closing the last
  // tab): the browser pane always offers a usable tab, like Cursor's.
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

  const openFindBar = useCallback(() => {
    setFindOpen(true);
    window.requestAnimationFrame(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
  }, []);

  const closeFindBar = useCallback(() => {
    setFindOpen(false);
    setFindQuery("");
    setFindResult({ matches: 0, ordinal: 0 });
    const tabId = activeTabIdRef.current;
    if (tabId) {
      void window.modus.browser.findStop({ tabId, action: "clearSelection" });
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

      if (event.type === "browser.find-result" && event.workspaceId === workspaceId) {
        if (event.tabId === activeTabIdRef.current) {
          setFindResult({ matches: event.matches, ordinal: event.activeMatchOrdinal });
        }
        return;
      }

      if (event.type === "browser.shortcut" && event.workspaceId === workspaceId) {
        if (event.shortcut === "focus-address") {
          focusAddress();
        } else if (event.shortcut === "find") {
          openFindBar();
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
  }, [workspaceId, focusAddress, openFindBar, toggleDesign]);

  // Address bar mirrors the active tab unless the user is editing it.
  useEffect(() => {
    if (document.activeElement !== addressInputRef.current) {
      setAddress(activeUrl === "about:blank" ? "" : activeUrl);
    }
  }, [activeUrl]);

  // Find state is per-page; switching tabs resets it.
  useEffect(() => {
    if (!activeId) {
      return;
    }
    setFindOpen(false);
    setFindQuery("");
    setFindResult({ matches: 0, ordinal: 0 });
  }, [activeId]);

  const createTab = useCallback(async (): Promise<void> => {
    if (!workspaceId) {
      return;
    }
    const tab = await window.modus.browser.createTab({ workspaceId });
    setTabs((current) => upsertTab(current, tab));
    setActiveTabId(tab.id);
    window.requestAnimationFrame(focusAddress);
  }, [workspaceId, focusAddress]);

  async function selectTab(tabId: string): Promise<void> {
    const tab = await window.modus.browser.selectTab({ tabId });
    setTabs((current) => upsertTab(current, tab));
    setActiveTabId(tab.id);
  }

  const closeTab = useCallback(async (tabId: string): Promise<void> => {
    await window.modus.browser.closeTab({ tabId });
  }, []);

  async function submitAddress(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!address.trim() || (!activeTab && !workspaceId)) {
      return;
    }
    const tab = await window.modus.browser.navigate({
      ...(activeTab ? { tabId: activeTab.id } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      url: address,
    });
    setTabs((current) => upsertTab(current, tab));
    setActiveTabId(tab.id);
    addressInputRef.current?.blur();
  }

  function runFind(query: string, findNext: boolean, forward: boolean): void {
    const tabId = activeTab?.id;
    if (!tabId) {
      return;
    }
    if (!query.trim()) {
      setFindResult({ matches: 0, ordinal: 0 });
      void window.modus.browser.findStop({ tabId, action: "clearSelection" });
      return;
    }
    void window.modus.browser.find({ tabId, query, findNext, forward });
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
      const chord = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const tab = tabs.find((entry) => entry.id === activeTabIdRef.current) ?? tabs.at(0);

      if (key === "f12" && tab) {
        void window.modus.browser.toggleDevtools({ tabId: tab.id });
      } else if ((key === "f5" || (chord && key === "r")) && tab) {
        void window.modus.browser.reload({ tabId: tab.id });
      } else if (chord && key === "t") {
        void createTab();
      } else if (chord && key === "w" && tab) {
        void closeTab(tab.id);
      } else if (chord && key === "l") {
        focusAddress();
      } else if (chord && key === "f") {
        openFindBar();
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
  }, [active, tabs, createTab, closeTab, focusAddress, openFindBar, toggleDesign]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel" ref={rootRef}>
      <BrowserTabStrip
        activeTabId={activeTab?.id}
        onClose={(tabId) => void closeTab(tabId)}
        onCreate={() => void createTab()}
        onSelect={(tabId) => void selectTab(tabId)}
        tabs={tabs}
      />
      <div className="flex h-9 shrink-0 items-center gap-0.5 border-hairline border-b px-1.5">
        <BrowserIconButton
          disabled={!activeTab?.canGoBack}
          label="Back"
          onClick={() => activeTab && void window.modus.browser.back({ tabId: activeTab.id })}
        >
          <IconArrowLeft size={15} stroke={1.65} />
        </BrowserIconButton>
        <BrowserIconButton
          disabled={!activeTab?.canGoForward}
          label="Forward"
          onClick={() => activeTab && void window.modus.browser.forward({ tabId: activeTab.id })}
        >
          <IconArrowRight size={15} stroke={1.65} />
        </BrowserIconButton>
        <BrowserIconButton
          disabled={!activeTab}
          label="Reload (F5)"
          onClick={() => activeTab && void window.modus.browser.reload({ tabId: activeTab.id })}
        >
          <IconRefresh
            className={cn(activeTab?.loading && "animate-spin")}
            size={15}
            stroke={1.65}
          />
        </BrowserIconButton>
        <form className="mx-1 min-w-0 flex-1" onSubmit={(event) => void submitAddress(event)}>
          <div className="relative">
            <span className="pointer-events-none absolute top-0 left-2.5 flex h-7 items-center text-fg-faint">
              <AddressIcon tab={activeTab} />
            </span>
            <input
              className="h-7 w-full rounded-md border border-transparent bg-input pr-3 pl-8 text-xs text-fg outline-none transition-colors placeholder:text-fg-faint focus:border-focus-ring/60"
              onChange={(event) => setAddress(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setAddress(activeUrl === "about:blank" ? "" : activeUrl);
                  event.currentTarget.blur();
                }
              }}
              placeholder="Search or enter URL (Ctrl+L)"
              ref={addressInputRef}
              spellCheck={false}
              value={address}
            />
          </div>
        </form>
        <DesignModeToggle active={designOn} disabled={!activeTab} onToggle={toggleDesign} />
        <BrowserIconButton
          active={findOpen}
          disabled={!activeTab}
          label="Find in page (Ctrl+F)"
          onClick={() => (findOpen ? closeFindBar() : openFindBar())}
        >
          <IconSearch size={15} stroke={1.65} />
        </BrowserIconButton>
        <BrowserIconButton
          active={Boolean(activeTab?.devtoolsOpen)}
          disabled={!activeTab}
          label="DevTools (F12)"
          onClick={() =>
            activeTab && void window.modus.browser.toggleDevtools({ tabId: activeTab.id })
          }
        >
          <IconDeviceDesktopCode size={15} stroke={1.65} />
        </BrowserIconButton>
        <BrowserIconButton
          disabled={!activeTab || !/^https?:/i.test(activeUrl)}
          label="Open in external browser"
          onClick={() =>
            activeTab && void window.modus.browser.openExternal({ tabId: activeTab.id })
          }
        >
          <IconExternalLink size={15} stroke={1.65} />
        </BrowserIconButton>
      </div>
      {findOpen && activeTab ? (
        <div className="flex h-9 shrink-0 items-center gap-1 border-hairline border-b px-2">
          <IconSearch className="shrink-0 text-fg-faint" size={14} stroke={1.65} />
          <input
            className="h-7 min-w-0 flex-1 rounded-md border border-transparent bg-input px-2 text-xs text-fg outline-none placeholder:text-fg-faint focus:border-focus-ring/60"
            onChange={(event) => {
              setFindQuery(event.target.value);
              runFind(event.target.value, false, true);
            }}
            onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
              if (event.key === "Enter") {
                event.preventDefault();
                runFind(findQuery, true, !event.shiftKey);
              } else if (event.key === "Escape") {
                event.preventDefault();
                closeFindBar();
              }
            }}
            placeholder="Find in page"
            ref={findInputRef}
            spellCheck={false}
            value={findQuery}
          />
          <span className="shrink-0 px-1 text-2xs text-fg-faint tabular-nums">
            {findQuery ? `${findResult.ordinal}/${findResult.matches}` : ""}
          </span>
          <BrowserIconButton
            disabled={!findQuery}
            label="Previous match"
            onClick={() => runFind(findQuery, true, false)}
          >
            <IconChevronUp size={14} stroke={1.65} />
          </BrowserIconButton>
          <BrowserIconButton
            disabled={!findQuery}
            label="Next match"
            onClick={() => runFind(findQuery, true, true)}
          >
            <IconChevronDown size={14} stroke={1.65} />
          </BrowserIconButton>
          <BrowserIconButton label="Close find bar" onClick={closeFindBar}>
            <IconX size={14} stroke={1.65} />
          </BrowserIconButton>
        </div>
      ) : null}
      <BrowserViewport active={active} onCreateTab={() => void createTab()} tabId={activeTab?.id} />
    </div>
  );
}

function AddressIcon({ tab }: { tab: BrowserTabInfo | undefined }) {
  if (tab?.loading) {
    return <IconLoader2 className="animate-spin" size={13} stroke={1.8} />;
  }
  const url = tab?.url ?? "";
  if (/^https:/i.test(url)) {
    return <IconLock size={13} stroke={1.8} />;
  }
  if (/^http:/i.test(url)) {
    return <IconLockOpen className="text-danger" size={13} stroke={1.8} />;
  }
  return <IconWorld size={13} stroke={1.8} />;
}

function BrowserTabStrip({
  activeTabId,
  tabs,
  onClose,
  onCreate,
  onSelect,
}: {
  activeTabId?: string | undefined;
  tabs: BrowserTabInfo[];
  onClose(tabId: string): void;
  onCreate(): void;
  onSelect(tabId: string): void;
}) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-hairline border-b px-1.5">
      <div className="scroll-thin flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => (
          <div
            className={cn(
              "group flex h-7 min-w-[120px] max-w-[200px] items-center rounded-md pr-1 transition-colors",
              activeTabId === tab.id ? "bg-active text-fg" : "text-fg-subtle hover:bg-hover",
            )}
            key={tab.id}
            onAuxClick={(event) => {
              // Middle-click closes, like every real browser.
              if (event.button === 1) {
                event.preventDefault();
                onClose(tab.id);
              }
            }}
          >
            <button
              className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-l-md pl-2 text-left outline-none"
              onClick={() => onSelect(tab.id)}
              title={tab.title || tab.url}
              type="button"
            >
              {tab.loading ? (
                <IconLoader2
                  className="shrink-0 animate-spin text-fg-faint"
                  size={13}
                  stroke={1.8}
                />
              ) : tab.favicon ? (
                <img alt="" className="size-3.5 shrink-0 rounded-[3px]" src={tab.favicon} />
              ) : (
                <IconWorld className="shrink-0 text-fg-faint" size={13} stroke={1.65} />
              )}
              <span className="min-w-0 flex-1 truncate text-xs">{tab.title || "New tab"}</span>
            </button>
            <button
              aria-label="Close tab"
              className="shrink-0 rounded-sm p-0.5 text-fg-faint opacity-60 transition-opacity hover:bg-chip-strong hover:text-fg group-hover:opacity-100"
              onClick={() => onClose(tab.id)}
              type="button"
            >
              <IconX size={12} stroke={1.8} />
            </button>
          </div>
        ))}
      </div>
      <BrowserIconButton label="New tab (Ctrl+T)" onClick={onCreate}>
        <IconPlus size={15} stroke={1.65} />
      </BrowserIconButton>
    </div>
  );
}

function BrowserViewport({
  active,
  tabId,
  onCreateTab,
}: {
  active: boolean;
  tabId?: string | undefined;
  onCreateTab(): void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // A full-screen DOM overlay (e.g. the image lightbox) is on top: native views
  // paint above the DOM, so the embedded browser must hide until it closes.
  const suppressed = useNativeSurfaceSuppressed();

  useEffect(() => {
    const host = hostRef.current;
    if (!active || !tabId || !host) {
      return undefined;
    }

    if (suppressed) {
      // Hide now; when suppression lifts this effect re-runs and re-shows the
      // view at freshly measured bounds. No observer while hidden.
      void window.modus.browser.hide({ tabId });
      return undefined;
    }

    let disposed = false;
    let lastBounds: BrowserBounds | null = null;

    // Initial show: attach + make visible + force bounds, unconditionally.
    // (Stale cached bounds were one root cause of the black-border bug.)
    const initialBounds = computeBrowserViewBounds(host.getBoundingClientRect());
    if (initialBounds.width > 0 && initialBounds.height > 0) {
      lastBounds = initialBounds;
      void window.modus.browser.show({ tabId, bounds: initialBounds });
    }

    const syncBounds = (): void => {
      if (disposed) {
        return;
      }
      const bounds = computeBrowserViewBounds(host.getBoundingClientRect());
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

    return () => {
      disposed = true;
      observer.disconnect();
      window.removeEventListener("resize", syncBounds);
      void window.modus.browser.hide({ tabId });
    };
  }, [active, tabId, suppressed]);

  return (
    <div className="relative min-h-0 flex-1 bg-panel">
      <div className="absolute inset-0" ref={hostRef} />
      {!tabId ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-fg-faint">
          <span>No browser tab</span>
          <button
            className="flex items-center gap-1.5 rounded-md bg-chip px-3 py-1.5 text-xs text-fg-subtle transition-colors hover:bg-chip-strong hover:text-fg"
            onClick={onCreateTab}
            type="button"
          >
            <IconPlus size={14} stroke={1.8} />
            New tab
          </button>
        </div>
      ) : null}
    </div>
  );
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
          "flex size-7 shrink-0 items-center justify-center rounded-md text-fg-faint transition-colors",
          active ? "bg-active text-fg" : "hover:bg-hover hover:text-fg-subtle",
          disabled && "cursor-not-allowed opacity-35 hover:bg-transparent hover:text-fg-faint",
        )}
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
