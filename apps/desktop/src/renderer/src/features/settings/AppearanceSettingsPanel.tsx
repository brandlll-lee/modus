import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { SettingsPageHeader } from "../../components/ui/SettingsPageHeader";
import { type ThemeMode, useTheme } from "../../lib/theme";
import { SettingsList, SettingsRow, SettingsSection } from "./SettingsLayout";

const themes: { value: ThemeMode; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "dark-plus", label: "Dim" },
];

export function AppearanceSettingsPanel() {
  const [theme, setTheme] = useTheme();
  return (
    <>
      <SettingsPageHeader title="Appearance" />
      <SettingsSection title="Visual style">
        <SettingsList>
          <SettingsRow
            title="Mode"
            control={
              <RadioGroup
                aria-label="Color theme"
                className="flex flex-wrap gap-3"
                value={theme}
                onValueChange={setTheme}
              >
                {themes.map(({ value, label }) => (
                  <label
                    key={value}
                    htmlFor={`theme-${value}`}
                    className="flex cursor-pointer flex-col items-center gap-2 text-xs text-fg-subtle"
                  >
                    <Radio.Root
                      id={`theme-${value}`}
                      value={value}
                      className="theme-preview"
                      data-preview={value}
                    >
                      <span className="theme-preview-sidebar" />
                      <span className="theme-preview-chat">
                        <span />
                        <span />
                        <span />
                        <span />
                      </span>
                    </Radio.Root>
                    {label}
                  </label>
                ))}
              </RadioGroup>
            }
          />
        </SettingsList>
        <SettingsList>
          <SettingsRow
            title="Font"
            control={<span className="text-sm text-fg-muted">System</span>}
          />
        </SettingsList>
      </SettingsSection>
    </>
  );
}
