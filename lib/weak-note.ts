/**
 * Client-safe. Do not import `lib/match` or `lib/db` from here — those pull
 * `node:sqlite`, and Turbopack panics if a client component even mentions them.
 */

export function weakDismissKey(via: string, kind: string, id: number): string {
  return `${via}:${kind}:${id}`;
}

export function weakDismissed(stored: string | null, key: string): boolean {
  if (!stored) return false;
  try {
    const rows = JSON.parse(stored) as unknown;
    return Array.isArray(rows) && rows.includes(key);
  } catch {
    return false;
  }
}

export function dismissWeak(stored: string | null, key: string): string {
  const rows = new Set<string>();
  try {
    const parsed = JSON.parse(stored ?? "[]") as unknown;
    if (Array.isArray(parsed)) {
      for (const r of parsed) if (typeof r === "string") rows.add(r);
    }
  } catch {
    /* ignore junk */
  }
  rows.add(key);
  return JSON.stringify([...rows]);
}
