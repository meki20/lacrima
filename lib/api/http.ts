import type { MediaKind, ProviderSlug } from "../media.ts";
import type { Profile } from "../profile.ts";
import type { Result } from "../result.ts";

export type ApiError = {
  code: string;
  message: string;
  lastSuccess?: number;
};

export type ApiEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

export class ApiFault extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function apiOk<T>(data: T, status = 200): Response {
  return Response.json({ ok: true, data } satisfies ApiEnvelope<T>, { status });
}

export function apiError(
  status: number,
  code: string,
  message: string,
  lastSuccess?: number,
): Response {
  return Response.json(
    {
      ok: false,
      error: { code, message, ...(lastSuccess == null ? {} : { lastSuccess }) },
    } satisfies ApiEnvelope<never>,
    { status },
  );
}

export function resultEnvelope<T>(r: Result<T>): ApiEnvelope<T> {
  return r.ok
    ? { ok: true, data: r.value }
    : {
        ok: false,
        error: {
          code: "upstream_unavailable",
          message: r.reason,
          ...(r.lastSuccess == null ? {} : { lastSuccess: r.lastSuccess }),
        },
      };
}

export function resultResponse<T>(r: Result<T>, status = 502): Response {
  return r.ok
    ? apiOk(r.value)
    : apiError(status, "upstream_unavailable", r.reason, r.lastSuccess);
}

export function profileFromHeaders(
  headers: Headers,
  profiles: Profile[],
  required = true,
): Profile | null {
  const raw = headers.get("x-lacrima-profile")?.trim();
  if (!raw) {
    if (required) throw new ApiFault(400, "profile_required", "X-Lacrima-Profile is required.");
    return null;
  }
  if (!/^\d+$/.test(raw)) {
    throw new ApiFault(400, "invalid_profile", "X-Lacrima-Profile must be a profile id.");
  }
  const profile = profiles.find((p) => p.id === Number(raw));
  if (!profile) throw new ApiFault(404, "profile_not_found", "No such profile.");
  return profile;
}

export function parseKind(raw: string | null | undefined): MediaKind {
  if (raw === "anime" || raw === "manga" || raw === "novel") return raw;
  throw new ApiFault(400, "invalid_kind", "Kind must be anime, manga, or novel.");
}

export function parseProvider(raw: string | null | undefined): ProviderSlug {
  if (raw === "anilist" || raw === "jikan" || raw === "kitsu") return raw;
  throw new ApiFault(400, "invalid_provider", "Provider must be anilist, jikan, or kitsu.");
}

export function positiveId(raw: unknown, field = "id"): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ApiFault(400, "invalid_id", `${field} must be a positive integer.`);
  }
  return n;
}

export async function jsonObject(req: Request): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await req.json();
  } catch {
    throw new ApiFault(400, "bad_json", "Request body must be valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiFault(400, "bad_json", "Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

export function finiteNumber(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : undefined;
}
