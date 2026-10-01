import type { WorkspaceInfo } from "../../../../shared/contracts";
import { SettingsPageHeader } from "../../components/ui/SettingsPageHeader";
import { ApprovalModeSettings } from "./ApprovalModeSettings";
export function GeneralSettingsPanel({
  cwd,
  workspaces = [],
}: {
  cwd?: string | undefined;
  workspaces?: WorkspaceInfo[] | undefined;
}) {
  return (
    <>
      <SettingsPageHeader
        description="Choose when Modus asks before risky agent actions — globally or per project."
        title="General"
      />
      <ApprovalModeSettings {...(cwd ? { cwd } : {})} workspaces={workspaces} />
    </>
  );
}
