import { Combobox } from "@base-ui/react/combobox";
import { Menu } from "@base-ui/react/menu";
import { IconCheck, IconChevronDown } from "@tabler/icons-react";
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
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Combobox.Root
        items={models}
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
              className="popup-chrome w-[320px] max-w-[calc(100vw-24px)] p-1.5"
            >
              <Combobox.Input
                aria-label="Search models"
                placeholder="Search models"
                className="mb-1 h-9 w-full rounded-md border border-hairline bg-canvas px-3 text-sm"
              />
              <Combobox.Empty className="p-4 text-sm text-fg-subtle">
                No matching models
              </Combobox.Empty>
              <Combobox.List className="scroll-thin max-h-[min(320px,var(--available-height))] overflow-y-auto">
                {(item: ModelInfo) => (
                  <Combobox.Item
                    key={item.id}
                    value={item}
                    disabled={!item.available}
                    className="flex min-h-11 cursor-default items-center gap-2 rounded-md px-2 py-2 text-sm outline-none data-highlighted:bg-hover data-disabled:opacity-40"
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
                    <Combobox.ItemIndicator>
                      <IconCheck size={15} />
                    </Combobox.ItemIndicator>
                  </Combobox.Item>
                )}
              </Combobox.List>
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
