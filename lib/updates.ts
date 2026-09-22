import { db, plain } from "./db.ts";
import packageJson from "../package.json" with { type: "json" };

const REPOSITORY = "https://github.com/meki20/lacrima";
const RELEASES = "https://api.github.com/repos/meki20/lacrima/releases?per_page=1";
const HEARTBEAT_MS = 90_000;

export type UpdatePreferences = { auto_update: boolean; update_time: string };
export type Release = { tag: string; name: string; url: string; published_at: number | null };
export type UpdateStatus = UpdatePreferences & {
  repository: string;
  latest_release: Release | null;
  version_label: string;
  update_available: boolean;
  last_checked_at: number | null;
  last_updated_at: number | null;
  last_status: string | null;
  update_queued: boolean;
  updater_online: boolean;
};

type Row = {
  auto_update: number;
  update_time: string;
  requested_at: number | null;
  last_checked_at: number | null;
  latest_tag: string | null;
  latest_name: string | null;
  latest_url: string | null;
  latest_published_at: number | null;
  last_applied_tag: string | null;
  last_updated_at: number | null;
  last_status: string | null;
  updater_heartbeat: number | null;
};

export function updateStatus(): UpdateStatus {
  const row = plain(db().prepare("select * from app_updates where singleton = 1").get() as Row);
  const latest_release = row.latest_tag && row.latest_name && row.latest_url
    ? { tag: row.latest_tag, name: row.latest_name, url: row.latest_url, published_at: row.latest_published_at }
    : null;
  const version = releaseVersion(latest_release);
  return {
    auto_update: Boolean(row.auto_update),
    update_time: validTime(row.update_time) ? row.update_time : "03:00",
    repository: REPOSITORY,
    latest_release,
    version_label: version.label,
    update_available: version.update_available,
    last_checked_at: row.last_checked_at,
    last_updated_at: row.last_updated_at,
    last_status: row.last_status,
    update_queued: row.requested_at != null,
    updater_online: row.updater_heartbeat != null && Date.now() - row.updater_heartbeat < HEARTBEAT_MS,
  };
}

export function saveUpdatePreferences(values: Partial<UpdatePreferences>): UpdateStatus {
  const current = updateStatus();
  const next = cleanPreferences({ ...current, ...values });
  db().prepare("update app_updates set auto_update = ?, update_time = ? where singleton = 1")
    .run(Number(next.auto_update), next.update_time);
  return updateStatus();
}

export function queueUpdate(): UpdateStatus {
  db().prepare("update app_updates set requested_at = ?, last_status = ? where singleton = 1")
    .run(Date.now(), "Update queued for the host updater.");
  return updateStatus();
}

export async function checkForRelease(): Promise<UpdateStatus> {
  const checked = Date.now();
  try {
    const response = await fetch(RELEASES, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Lacrima-updater" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error("GitHub could not be reached.");

    const release = releaseFromGithub(await response.json());
    if (!release) {
      db().prepare("update app_updates set last_checked_at = ?, latest_tag = null, latest_name = null, latest_url = null, latest_published_at = null, last_status = ? where singleton = 1")
        .run(checked, "No releases have been published yet.");
      return updateStatus();
    }
    db().prepare("update app_updates set last_checked_at = ?, latest_tag = ?, latest_name = ?, latest_url = ?, latest_published_at = ?, last_status = ? where singleton = 1")
      .run(checked, release.tag, release.name, release.url, release.published_at, `Latest release: ${release.tag}.`);
  } catch (error) {
    const message = error instanceof Error && error.message === "GitHub returned an invalid release."
      ? error.message
      : "Could not check GitHub. Try again shortly.";
    db().prepare("update app_updates set last_checked_at = ?, last_status = ? where singleton = 1")
      .run(checked, message);
  }
  return updateStatus();
}

export function cleanPreferences(values: Partial<UpdatePreferences>): UpdatePreferences {
  return { auto_update: values.auto_update === true, update_time: validTime(values.update_time) ? values.update_time : "03:00" };
}

export function releaseFromGithub(value: unknown): Release | null {
  if (Array.isArray(value)) return releaseFromGithub(value[0]);
  if (!value || typeof value !== "object") return null;
  const release = value as Record<string, unknown>;
  if (typeof release.tag_name !== "string" || typeof release.html_url !== "string") return null;
  const tag = release.tag_name.trim().slice(0, 80);
  const url = safeGithubUrl(release.html_url);
  if (!tag || !url) return null;
  const name = typeof release.name === "string" && release.name.trim()
    ? release.name.trim().slice(0, 160)
    : tag;
  const published = typeof release.published_at === "string" ? Date.parse(release.published_at) : NaN;
  return { tag, name, url, published_at: Number.isFinite(published) ? published : null };
}

export function releaseVersion(release: Release | null, installed = packageJson.version) {
  const current = versionKey(installed);
  const available = versionKey(release?.tag);
  return available && available === current
    ? { label: `Version ${available}`, update_available: false }
    : { label: "local dev", update_available: Boolean(available) };
}

function validTime(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return false;
  const [hour, minute] = value.split(":").map(Number);
  return hour < 24 && minute < 60;
}

function safeGithubUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" ? url.toString() : null;
  } catch {
    return null;
  }
}

function versionKey(value: string | undefined) {
  return value?.trim().replace(/^v/i, "") ?? "";
}
