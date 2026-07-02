// Compile-time-checked column lists for replacing select('*').
//
// columnsOf<Row>()([...keys]) returns 'a, b, c' for PostgREST .select(), and
// fails to compile if the list has a typo (not a key of Row) or is missing a
// key of Row. That guarantees the fetched shape actually matches the declared
// row type — the silent failure mode of a hand-narrowed select is a column
// the type promises but the query no longer returns.
//
// For intentionally partial lists (e.g. customers LIST_COLUMNS) keep a plain
// string — this helper is only for "the whole declared row, explicitly".

export function columnsOf<T>() {
  return <K extends readonly (keyof T & string)[]>(
    keys: K &
      (Exclude<keyof T, K[number]> extends never
        ? unknown
        : { __missingColumns: Exclude<keyof T, K[number]> })
  ): string => (keys as readonly string[]).join(', ')
}
