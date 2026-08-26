// One CSV serializer for the whole app.
//
// There were five copies of escapeCsv living in five client components, all
// carrying the same formula-injection guard and the same BOM comment. They had
// already begun to drift. This is the single copy.
//
// No server import belongs in here — client components download CSVs as blobs.

/** Quote a cell and neutralise spreadsheet formula injection.
 *
 *  A cell beginning `=`, `+`, `-` or `@` is executed as a formula by Excel,
 *  Sheets and LibreOffice on open. A customer or equipment name is attacker-
 *  reachable text, so the leading character is escaped with an apostrophe,
 *  which those tools strip on display. */
export function escapeCsv(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  const guarded = /^[=+\-@]/.test(s) ? `'${s}` : s
  return `"${guarded.replace(/"/g, '""')}"`
}

/** Join header + rows into a CSV body with a UTF-8 BOM.
 *
 *  The BOM is what makes Excel on Windows read the file as UTF-8 instead of
 *  cp1252; without it, any non-ASCII character in a customer name renders as
 *  mojibake. */
export function toCsv(header: readonly string[], rows: readonly unknown[][]): string {
  return (
    '﻿' +
    [header, ...rows].map((r) => r.map(escapeCsv).join(',')).join('\n')
  )
}

/** Trigger a browser download of `content` as `filename`. Client-side only. */
export function downloadCsv(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8;' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
