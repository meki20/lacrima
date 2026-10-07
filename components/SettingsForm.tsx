"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LANGS } from "@/lib/audio";
import { KIND_INFO, toggleKind } from "@/lib/kinds";
import { MEDIA_KINDS, type MediaKind } from "@/lib/media";
import type { Settings } from "@/lib/settings";

export default function SettingsForm({ initial }: { initial: Settings }) {
  const router = useRouter();
  const [settings, setSettings] = useState(initial);
  const [kindError, setKindError] = useState("");
  const saving = useRef(false);
  // Optimistic, but unlike the selects a failure is reverted and said out loud:
  // a category that looks hidden and isn't (or the reverse) is worse than a stale font size.
  const toggle = async (kind: MediaKind) => {
    if (saving.current) return;
    const before = settings.hidden_kinds;
    const next = toggleKind(before, kind);
    if (next.length === before.length && next.every((k, i) => k === before[i])) return;
    saving.current = true;
    setKindError("");
    setSettings((current) => ({ ...current, hidden_kinds: next }));
    try {
      const res = await fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ hidden_kinds: next }) });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setSettings((current) => ({ ...current, hidden_kinds: before }));
      setKindError(`Couldn’t save that change, so ${KIND_INFO[kind].label} is back as it was. Try again.`);
    } finally {
      saving.current = false;
    }
  };
  const shown = MEDIA_KINDS.filter((k) => !settings.hidden_kinds.includes(k));
  const save = (patch: Partial<Settings>) => {
    setSettings((current) => ({ ...current, ...patch }));
    void fetch("/api/settings", { method: "PUT", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
  };
  return <div className="settings-form">
    <section className="settings-card"><div><h2>Playback</h2><p>Defaults for every new episode.</p></div>
      <label>Default audio language<select value={settings.audio_lang} onChange={(e) => save({ audio_lang: e.target.value as Settings["audio_lang"] })}>{LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select></label>
      <label>Subtitles<select value={settings.subtitle_lang} onChange={(e) => save({ subtitle_lang: e.target.value })}><option value="auto">English when needed</option><option value="off">Off</option></select></label>
      <label>Caption size<select value={settings.caption_scale} onChange={(e) => save({ caption_scale: Number(e.target.value) })}><option value="1">Small</option><option value="1.2">Medium</option><option value="1.45">Large</option></select></label>
    </section>
    <section className="settings-card"><div><h2>Manga reader</h2><p>Used when a title has no personal reader override yet.</p></div>
      <label>Reading mode<select value={settings.reader_mode} onChange={(e) => save({ reader_mode: e.target.value as Settings["reader_mode"] })}><option value="paged">Paged</option><option value="webtoon">Webtoon</option></select></label>
      <label>Direction<select value={settings.reader_rtl} onChange={(e) => save({ reader_rtl: Number(e.target.value) })}><option value="1">Right to left</option><option value="0">Left to right</option></select></label>
      <label>Page fit<select value={settings.reader_fit} onChange={(e) => save({ reader_fit: e.target.value as Settings["reader_fit"] })}><option value="height">Height</option><option value="width">Width</option><option value="contain">Screen</option></select></label>
      <label>Page layout<select value={settings.reader_spread} onChange={(e) => save({ reader_spread: e.target.value as Settings["reader_spread"] })}><option value="single">Single page</option><option value="double">Double page</option></select></label>
    </section>
    <section className="settings-card kinds-card"><div><h2>Categories</h2><p>Hidden categories disappear from navigation, Home, search and Yours. Titles you already have still open from direct links.</p></div>
      {MEDIA_KINDS.map((kind) => {
        const on = !settings.hidden_kinds.includes(kind);
        const last = on && shown.length === 1;
        return <label key={kind}>
          <span className="kind-text"><b>{KIND_INFO[kind].label}</b><small id={`kind-${kind}-sub`}>{last ? "Keep at least one category on" : KIND_INFO[kind].blurb}</small></span>
          <input type="checkbox" role="switch" checked={on} aria-checked={on} disabled={last} aria-describedby={`kind-${kind}-sub`} onChange={() => void toggle(kind)} />
        </label>;
      })}
      <p className={kindError ? "kinds-note err" : "kinds-note"} role="status" aria-live="polite">{kindError}</p>
    </section>
  </div>;
}
