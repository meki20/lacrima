/**
 * Data rule 2 (CLAUDE.md): sources and providers never return a bare array.
 * "Down" must be structurally distinct from "empty" so the UI cannot render an
 * empty grid for a failure.
 */
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; lastSuccess?: number };

export const Ok = <T>(value: T): Result<T> => ({ ok: true, value });

export const Err = <T>(reason: string, lastSuccess?: number): Result<T> => ({
  ok: false,
  reason,
  lastSuccess,
});

/** Unwrap for rendering: value on success, `fallback` on failure. Never throws. */
export function or<T>(r: Result<T>, fallback: T): T {
  return r.ok ? r.value : fallback;
}
