import { Combobox } from "@base-ui/react/combobox";
import { Menu } from "@base-ui/react/menu";
import { IconCheck, IconChevronDown } from "@tabler/icons-react";
import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import { type RefObject, useImperativeHandle, useRef } from "react";
import type { ModelInfo } from "../../../../shared/contracts";
import { ProviderLogo } from "../../components/providers/ProviderLogo";
import {
  modelThinkingOptions,
  selectedThinkingLabel,
  selectedThinkingOption,
} from "../../lib/modelThinking";

export function ModelSelect({
  model,
  models,
  onModelChange,
  onModelConfigChange,
}: {
  model: string;
  models: ModelInfo[];
  onModelChange(model: string): void;
  onModelConfigChange?(model: string, thinkingVariant: string): Promise<void> | void;
}) {
  const current = models.find((item) => item.id === model);
  const thinkingOptions = current ? modelThinkingOptions(current) : [];
  const thinkingSelection = current ? selectedThinkingOption(current) : undefined;
  const virtualizerRef = useRef<Virtualizer<HTMLDivElement, HTMLDivElement>>(null);
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Combobox.Root
        items={models}
        virtualized
        onItemHighlighted={(item, details) => {
          if (item && details.reason !== "pointer") {
            virtualizerRef.current?.scrollToIndex(details.index, { align: "auto" });
          }
        }}
        value={current ?? null}
        itemToStringLabel={(item) => `${item.name} ${item.providerName ?? item.provider}`}
        isItemEqualToValue={(a, b) => a.id === b.id}
        onValueChange={(item) => {
          if (item) onModelChange(item.id);
        }}
      >
        <Combobox.Trigger
          aria-label="Select model"
          className="flex h-8 min-w-0 items-center gap-1.5 rounded-md px-2 text-sm hover:bg-hover"
        >
          <span className="min-w-0 truncate">
            {current?.name ?? (model ? `${model} (unavailable)` : "Select model")}
          </span>
          <IconChevronDown className="shrink-0 text-fg-subtle" size={12} />
        </Combobox.Trigger>
        <Combobox.Portal>
          <Combobox.Positioner side="top" align="end" sideOffset={8}>
            <Combobox.Popup
              aria-label="Models"
              initialFocus={false}
              className="popup-chrome selection-surface"
            >
              <Combobox.Input
                aria-label="Search models"
                placeholder="Search models"
                className="search-control px-3"
              />
              <Combobox.Empty>
                <div className="p-4 text-sm text-fg-subtle">No matching models</div>
              </Combobox.Empty>
              <ModelOptions virtualizerRef={virtualizerRef} />
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
      {current?.supportsThinking && thinkingOptions.length && onModelConfigChange ? (
        <Menu.Root>
          <Menu.Trigger
            aria-label="Thinking level"
            className="flex h-8 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs text-fg-subtle hover:bg-hover"
          >
            {selectedThinkingLabel(current)}
            <IconChevronDown size={12} />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner side="top" align="end" sideOffset={8}>
              <Menu.Popup className="popup-chrome min-w-40 p-1">
                {thinkingOptions.map((option) => (
                  <Menu.Item
                    key={option.value}
                    onClick={() => void onModelConfigChange(current.id, option.value)}
                    className="flex min-h-8 cursor-default items-center justify-between gap-4 rounded-md px-3 text-sm outline-none data-highlighted:bg-hover"
                  >
                    {option.label}
                    {thinkingSelection?.value === option.value ? <IconCheck size={14} /> : null}
                  </Menu.Item>
                ))}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      ) : null}
    </div>
  );
}

function ModelOptions({
  virtualizerRef,
}: {
  virtualizerRef: RefObject<Virtualizer<HTMLDivElement, HTMLDivElement> | null>;
}) {
  const items = Combobox.useFilteredItems<ModelInfo>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 56,
    getItemKey: (index) => items[index]?.id ?? index,
    overscan: 4,
  });
  useImperativeHandle(virtualizerRef, () => virtualizer, [virtualizer]);
  return (
    <Combobox.List
      ref={scrollRef}
      className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain"
    >
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => {
          const item = items[row.index];
          if (!item) return null;
          return (
            <Combobox.Item
              key={item.id}
              value={item}
              index={row.index}
              aria-setsize={items.length}
              aria-posinset={row.index + 1}
              disabled={!item.available}
              className="absolute top-0 left-0 flex w-full cursor-default items-center gap-2 rounded-md px-2 text-sm outline-none data-highlighted:bg-hover data-disabled:opacity-40"
              style={{ height: row.size, transform: `translateY(${row.start}px)` }}
            >
              <ProviderLogo
                provider={item.provider}
                name={item.providerName ?? item.provider}
                size="sm"
                framed={false}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{item.name}</span>
                <span className="block truncate text-xs text-fg-subtle">
                  {item.providerName ?? item.provider}
                </span>
              </span>
              <span className="flex w-4 shrink-0 justify-center">
                <Combobox.ItemIndicator>
                  <IconCheck size={15} />
                </Combobox.ItemIndicator>
              </span>
            </Combobox.Item>
          );
        })}
      </div>
    </Combobox.List>
  );
}
