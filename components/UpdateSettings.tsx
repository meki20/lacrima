"use client";

import { useEffect, useState } from "react";
import type { UpdatePreferences, UpdateStatus } from "@/lib/updates";

export default function UpdateSettings({ initial }: { initial: UpdateStatus }) {
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState<"check" | "update" | null>(null);

  useEffect(() => {
    let active = true;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch("/api/updates", { cache: "no-store" });
        if (response.ok) {
          const result = await response.json() as { status: UpdateStatus };
          if (active) setStatus(result.status);
        }
      } catch { /* The app may briefly restart during an update. */ }
    }, 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const save = async (patch: Partial<UpdatePreferences>) => {
    setStatus((current) => ({ ...current, ...patch }));
    const response = await fetch("/api/updates", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    if (response.ok) setStatus((await response.json() as { status: UpdateStatus }).status);
  };
  const act = async (action: "check" | "update") => {
    setBusy(action);
    try {
      const response = await fetch("/api/updates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      if (response.ok) setStatus((await response.json() as { status: UpdateStatus }).status);
      else setStatus((current) => ({ ...current, last_status: "That update action could not be completed." }));
    } catch {
      setStatus((current) => ({ ...current, last_status: "Could not contact Lacrima. Try again shortly." }));
    } finally {
      setBusy(null);
    }
  };

  const hint = !status.updater_online
    ? "The updater has not checked in recently. Check the lacrima-updater container and its logs."
    : status.last_status ?? "No update activity yet.";
  return <section className="settings-card update-card">
    <h2>Updates <span>· {status.version_label}</span></h2>
    <a className="update-repo" href={status.repository} target="_blank" rel="noreferrer">Lacrima on GitHub</a>
    <div className="update-actions">
      <button className="btn" type="button" onClick={() => void act("check")} disabled={busy !== null}>{busy === "check" ? "Checking…" : "Check for updates"}</button>
      <button className="btn primary" type="button" onClick={() => void act("update")} disabled={busy !== null || status.update_queued || !status.update_available}>{busy === "update" ? "Queuing…" : "Update now"}</button>
    </div>
    <div className="update-controls">
      <label>Automatic updates<input type="checkbox" checked={status.auto_update} onChange={(e) => void save({ auto_update: e.target.checked })} /></label>
      <label>Update time<input type="time" value={status.update_time} onChange={(e) => void save({ update_time: e.target.value })} /></label>
    </div>
    <p className="update-note" aria-live="polite">{hint}</p>
  </section>;
}
