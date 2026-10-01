import { IconAlertCircle, IconRefresh } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { ActionRow } from "./ActionRow";
import type { RequestStatusBlockItem } from "./Timeline";

export function RequestStatusRow({ item }: { item: RequestStatusBlockItem }) {
  const [now, setNow] = useState(Date.now);
  const active = item.status === "retrying";
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  const seconds = item.nextAt ? Math.max(0, Math.ceil((item.nextAt - now) / 1000)) : 0;
  const count = item.attempt !== undefined ? ` ${item.attempt}/${item.maxAttempts}` : "";
  const label = active
    ? `Retry${count}${seconds > 0 ? ` · in ${seconds}s` : " · retrying"}`
    : item.status === "failed"
      ? "Request failed"
      : item.status === "cancelled"
        ? "Retry stopped"
        : `Retry${count} · ${item.recovered ? "recovered" : "ended"}`;
  return (
    <ActionRow
      icon={item.status === "failed" ? <IconAlertCircle /> : <IconRefresh />}
      label={label}
      target={active || item.status === "failed" ? item.detail?.split("\n")[0] : undefined}
      detail={item.detail}
      active={active}
      danger={item.status === "failed"}
    />
  );
}
