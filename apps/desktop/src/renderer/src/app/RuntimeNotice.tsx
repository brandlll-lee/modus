import { IconInfoCircle, IconX } from "@tabler/icons-react";
import type { AgentEvent } from "../../../shared/contracts";
import { ToolbarButton } from "../components/ui/ToolbarButton";

export function RuntimeNotice({
  notice,
  onDismiss,
}: {
  notice: Extract<AgentEvent, { type: "extension.notice" }>;
  onDismiss(): void;
}) {
  return (
    <aside
      role={notice.level === "error" ? "alert" : "status"}
      className="flex shrink-0 items-start gap-3 border-b border-hairline bg-panel px-4 py-2 text-sm text-fg-muted"
    >
      <IconInfoCircle size={16} className="mt-0.5 shrink-0" />
      <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">{notice.message}</p>
      <ToolbarButton label="Dismiss notification" onClick={onDismiss}>
        <IconX size={16} />
      </ToolbarButton>
    </aside>
  );
}
