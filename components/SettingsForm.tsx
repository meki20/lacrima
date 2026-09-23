"use client";

import { useState } from "react";
import { LANGS } from "@/lib/audio";
import type { Settings } from "@/lib/settings";

export default function SettingsForm({ initial }: { initial: Settings }) {
  const [settings, setSettings] = useState(initial);
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
  </div>;
}
