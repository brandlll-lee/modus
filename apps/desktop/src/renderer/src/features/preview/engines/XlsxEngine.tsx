import ExcelJS from "exceljs";
import { useEffect, useState } from "react";
import type { PreviewEngineProps } from "../registry";

type SheetView = {
  name: string;
  rows: string[][];
};

/** Spreadsheet (.xlsx) preview via ExcelJS → HTML tables (read-only). */
export default function XlsxEngine({ bytes }: PreviewEngineProps) {
  const [sheets, setSheets] = useState<SheetView[]>([]);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const workbook = new ExcelJS.Workbook();
        // exceljs typings accept Buffer-like; Uint8Array works at runtime.
        await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
        if (cancelled) return;
        const next: SheetView[] = [];
        workbook.eachSheet((sheet) => {
          const rows: string[][] = [];
          sheet.eachRow({ includeEmpty: false }, (row) => {
            const values = row.values;
            const cells: string[] = [];
            if (Array.isArray(values)) {
              for (let i = 1; i < values.length; i += 1) {
                const cell = values[i];
                cells.push(cell == null ? "" : String(typeof cell === "object" && cell !== null && "text" in cell ? (cell as { text: string }).text : cell));
              }
            }
            rows.push(cells);
          });
          next.push({ name: sheet.name, rows });
        });
        setSheets(next);
        setActive(0);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bytes]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-fg-faint text-xs">
        {error}
      </div>
    );
  }
  if (sheets.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-fg-faint text-xs">
        Loading spreadsheet…
      </div>
    );
  }

  const sheet = sheets[active] ?? sheets[0];
  if (!sheet) {
    return null;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 gap-1 overflow-x-auto border-hairline border-b px-2 py-1.5">
        {sheets.map((s, i) => (
          <button
            className={
              i === active
                ? "rounded-md bg-hover px-2.5 py-1 text-2xs text-fg"
                : "rounded-md px-2.5 py-1 text-2xs text-fg-subtle hover:bg-hover"
            }
            key={`${s.name}-${i}`}
            onClick={() => setActive(i)}
            type="button"
          >
            {s.name}
          </button>
        ))}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-auto p-2">
        <table className="border-collapse text-2xs text-fg">
          <tbody>
            {sheet.rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td
                    className="max-w-60 truncate border border-hairline px-2 py-1 align-top"
                    key={ci}
                    title={cell}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
