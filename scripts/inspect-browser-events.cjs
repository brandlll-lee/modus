/* Diagnostic helper (temporary): join tool.started/tool.ended browser events
 * to reconstruct the agent's tool calls with their actual results. */
const { DatabaseSync } = require("node:sqlite");

const db = new DatabaseSync("C:/Users/ASUS/AppData/Roaming/@modus/desktop/modus.sqlite", {
  readOnly: true,
});

const rows = db
  .prepare(
    "SELECT id, type, payload_json, created_at FROM agent_events WHERE type IN ('tool.started','tool.ended') AND created_at > '2026-06-12T16:35' ORDER BY id ASC",
  )
  .all();

const started = new Map();
const events = [];
for (const row of rows) {
  let parsed;
  try {
    parsed = JSON.parse(row.payload_json);
  } catch {
    continue;
  }
  if (row.type === "tool.started") {
    started.set(parsed.toolCallId, { ...parsed, at: row.created_at });
    continue;
  }
  const start = started.get(parsed.toolCallId);
  const name = parsed.toolName ?? start?.toolName ?? "?";
  if (!String(name).startsWith("browser_")) continue;
  events.push({ at: start?.at ?? row.created_at, name, args: start?.args, ended: parsed });
}

for (const event of events) {
  console.log("═".repeat(76));
  console.log(`${event.at}  ${event.name}`);
  console.log(`  args : ${JSON.stringify(event.args ?? {}).slice(0, 360)}`);
  const { toolCallId, type, toolName, ...rest } = event.ended;
  console.log(`  ended: ${JSON.stringify(rest).slice(0, 2400)}`);
}
console.log(`\n${events.length} completed browser tool calls since 16:35`);
