import { db, plain, plainAll } from "./db.ts";
import { parseLang, type Lang } from "./audio.ts";
import { parseCaptionScale } from "./subs.ts";
import { parseReaderPrefs, type ReaderPrefs } from "./reader-prefs.ts";

export type Settings = {
  audio_lang: Lang;
  subtitle_lang: string;
  caption_scale: number;
  reader_mode: ReaderPrefs["mode"];
  reader_rtl: number;
  reader_fit: ReaderPrefs["fit"];
  reader_spread: ReaderPrefs["spread"];
};

const DEFAULT: Settings = {
  audio_lang: "ja", subtitle_lang: "auto", caption_scale: 1,
  reader_mode: "paged", reader_rtl: 1, reader_fit: "height", reader_spread: "single",
};

export function profileSettings(profileId: number): Settings {
  const row = db().prepare("select * from profile_settings where profile_id = ?").get(profileId) as Settings | undefined;
  return row ? clean(plain(row)) : { ...DEFAULT };
}

export function subtitleChoice(profileId: number, via: string, mediaId: number, chapterId: string): string | null {
  const row = db().prepare("select choice from subtitle_choices where profile_id = ? and via = ? and media_id = ? and chapter_id = ?")
    .get(profileId, via, mediaId, chapterId) as { choice: string } | undefined;
  return row?.choice ?? null;
}

export function updateSubtitleChoice(profileId: number, via: string, mediaId: number, chapterId: string, choice: string) {
  db().prepare(`insert into subtitle_choices (profile_id, via, media_id, chapter_id, choice) values (?, ?, ?, ?, ?)
    on conflict(profile_id, via, media_id, chapter_id) do update set choice = excluded.choice`)
    .run(profileId, via, mediaId, chapterId, choice);
}

export function updateProfileSettings(profileId: number, values: Partial<Settings>) {
  const next = clean({ ...profileSettings(profileId), ...values });
  db().prepare(`insert into profile_settings
    (profile_id, audio_lang, subtitle_lang, caption_scale, reader_mode, reader_rtl, reader_fit, reader_spread)
    values (?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(profile_id) do update set
      audio_lang=excluded.audio_lang, subtitle_lang=excluded.subtitle_lang, caption_scale=excluded.caption_scale,
      reader_mode=excluded.reader_mode, reader_rtl=excluded.reader_rtl, reader_fit=excluded.reader_fit, reader_spread=excluded.reader_spread`
  ).run(profileId, next.audio_lang, next.subtitle_lang, next.caption_scale, next.reader_mode, next.reader_rtl, next.reader_fit, next.reader_spread);
  return next;
}

export function readerSettings(s: Settings): ReaderPrefs {
  return parseReaderPrefs(JSON.stringify({ mode: s.reader_mode, rtl: Boolean(s.reader_rtl), fit: s.reader_fit, spread: s.reader_spread }));
}

export function recordProviderChoice(profileId: number, provider: string) {
  const name = provider.trim().slice(0, 160);
  if (name) db().prepare("insert into provider_choices (profile_id, provider, chosen_at) values (?, ?, ?)").run(profileId, name, Date.now());
}

export type ProviderStat = { provider: string; times: number; last_used: number };
export function bestProviders(profileId: number): ProviderStat[] {
  return plainAll(db().prepare(`select provider, count(*) as times, max(chosen_at) as last_used
    from provider_choices where profile_id = ? group by provider order by times desc, last_used desc`).all(profileId) as ProviderStat[]);
}

function clean(s: Partial<Settings>): Settings {
  const reader = parseReaderPrefs(JSON.stringify({ mode: s.reader_mode, rtl: Boolean(s.reader_rtl), fit: s.reader_fit, spread: s.reader_spread }));
  return {
    audio_lang: parseLang(s.audio_lang) ?? "ja",
    subtitle_lang: s.subtitle_lang === "off" ? "off" : "auto",
    caption_scale: parseCaptionScale(String(s.caption_scale)),
    reader_mode: reader.mode, reader_rtl: reader.rtl ? 1 : 0, reader_fit: reader.fit, reader_spread: reader.spread,
  };
}
