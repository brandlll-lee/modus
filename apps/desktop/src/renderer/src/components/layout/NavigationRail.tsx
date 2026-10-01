import { IconHome, IconSettings } from "@tabler/icons-react";
import modusLogo from "../../assets/modus-logo.png";
import { ToolbarButton } from "../ui/ToolbarButton";

export function NavigationRail({
  settingsOpen,
  onHome,
  onSettings,
}: {
  settingsOpen: boolean;
  onHome(): void;
  onSettings(): void;
}) {
  return (
    <nav aria-label="Main navigation" className="navigation-rail">
      <img alt="Modus" className="my-3 size-7 object-contain" src={modusLogo} />
      <ToolbarButton active={!settingsOpen} className="rail-button" label="Chats" onClick={onHome}>
        <IconHome size={21} stroke={1.6} />
      </ToolbarButton>
      <div className="flex-1" />
      <ToolbarButton
        active={settingsOpen}
        className="rail-button"
        label="Settings"
        onClick={onSettings}
      >
        <IconSettings size={21} stroke={1.6} />
      </ToolbarButton>
    </nav>
  );
}
