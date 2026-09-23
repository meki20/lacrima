import type { Anchor } from "@/lib/db";
import { parseLang, type Lang } from "@/lib/audio";
import {
  backfillLibrary,
  filterLibrary,
  getLibrary,
  libraryGenres,
  listLibrary,
  parseSort,
  parseStatus,
  removeLibrary,
  reorderPins,
  setPinned,
  shelfItems,
  sortLibrary,
  upsertLibrary,
} from "@/lib/library";
import type { Media, MediaKind, ProviderSlug } from "@/lib/media";
import { GENRES } from "@/lib/media";
import { fetchBrowse, fetchHome, fetchSearch, fetchTitle } from "@/lib/metadata";
import { ACCENTS, allProfiles, createProfile, deleteProfile, parseHex, profileGenres, topGenre, updateProfile } from "@/lib/profile";
import { continueReading, getProgress, parseAnchor, removeHistory, setProgressTree } from "@/lib/progress";
import {
  commitPick,
  fastPlaylist,
  getCachedPick,
  loadPlaylist,
  savePlaylist,
  withCacheParams,
  type CacheCtx,
} from "@/lib/play-cache";
import { chaptersFor, pinBinding, resolveSource } from "@/lib/resolve";
import { bestProviders, profileSettings, recordProviderChoice, updateProfileSettings, type Settings } from "@/lib/settings";
import { backend, allRemoteSources, clearSourceHealth } from "@/lib/sources";
import { resolveStreams, resolveSubtitles } from "@/lib/sources/stremio";
import { fileHref } from "@/lib/subs";
import { decodeSubBytes, readSubBody } from "@/lib/sub-cache";
import { disabledIds, setSourceDisabled } from "@/lib/sources/store";
import {
  episodeWindow,
  fetchSeries,
  progressTree,
  seriesTitle,
  windowEpisodes,
} from "@/lib/series";
import {
  collectionFor,
  earnedCatalog,
  earnedCount,
  toggleSticker,
} from "@/lib/stickers";
import {
  addPlacement,
  listPlacements,
  movePlacement,
  removePlacement,
} from "@/lib/sticker-placements";
import { collectFacts, loadActivity, loadProgress, monthMix } from "@/lib/yours";
import {
  forLang,
  fromProviders,
  mixedRaceUrl,
  remuxUrl,
  splitPicks,
  torrentRaceUrl,
  TORRENT_RACE_MAX,
  type Playlist,
  type StreamGroup,
  type StreamPick,
} from "@/lib/streams";
import {
  ApiFault,
  apiError,
  apiOk,
  finiteNumber,
  jsonObject,
  optionalString,
  parseKind,
  parseProvider,
  positiveId,
  profileFromHeaders,
  resultEnvelope,
  resultResponse,
} from "@/lib/api/http";
import { sanitizeNovelHtml } from "@/lib/api/sanitize";
import { skipTimes } from "@/lib/skip-times";
import packageJson from "../../../../package.json" with { type: "json" };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ path: string[] }> };

async function pathOf(ctx: Context) {
  return (await ctx.params).path ?? [];
}

function profile(req: Request) {
  return profileFromHeaders(req.headers, allProfiles())!;
}

function titlePath(path: string[], at = 1) {
  return {
    via: parseProvider(path[at]),
    kind: parseKind(path[at + 1]),
    id: positiveId(path[at + 2], "media id"),
  };
}

function nullableString(value: unknown): string | null | undefined {
  return value === null ? null : optionalString(value);
}

function anchorFrom(value: unknown): Anchor {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiFault(400, "invalid_anchor", "A portable progress anchor is required.");
  }
  const a = value as Record<string, unknown>;
  const chapterId = typeof a.chapterId === "string" || typeof a.chapterId === "number" ? a.chapterId : undefined;
  if (a.kind === "seconds") {
    const at = finiteNumber(a.at);
    if (at == null || at < 0 || typeof chapterId !== "string" || !chapterId) {
      throw new ApiFault(400, "invalid_anchor", "A video anchor needs seconds and a chapter id.");
    }
    const duration = finiteNumber(a.duration);
    const season = finiteNumber(a.season);
    const episode = finiteNumber(a.episode);
    return {
      kind: "seconds",
      at,
      chapterId,
      chapterName: optionalString(a.chapterName) ?? "",
      ...(duration != null && duration > 0 ? { duration } : {}),
      ...(season != null ? { season: Math.max(0, Math.floor(season)) } : {}),
      ...(episode != null && episode > 0 ? { episode: Math.floor(episode) } : {}),
    };
  }
  if (a.kind === "page") {
    const index = finiteNumber(a.index);
    if (index == null || index < 0 || chapterId == null) {
      throw new ApiFault(400, "invalid_anchor", "A manga anchor needs a page index and chapter id.");
    }
    const pages = finiteNumber(a.pages);
    return {
      kind: "page",
      index: Math.floor(index),
      chapterId,
      chapterName: optionalString(a.chapterName) ?? "",
      ...(pages != null && pages > 0 ? { pages: Math.floor(pages) } : {}),
    };
  }
  if (a.kind === "paragraph") {
    const cfi = optionalString(a.cfi);
    if (!cfi) throw new ApiFault(400, "invalid_anchor", "A novel anchor needs a paragraph or CFI value.");
    return {
      kind: "paragraph",
      cfi,
      ...(chapterId == null ? {} : { chapterId }),
      ...(optionalString(a.chapterName) ? { chapterName: optionalString(a.chapterName) } : {}),
    };
  }
  throw new ApiFault(400, "invalid_anchor", "Unknown progress anchor kind.");
}

function progressDto(row: ReturnType<typeof getProgress>) {
  return row ? { ...row, anchor: parseAnchor(row.anchor) } : null;
}

async function sourceHealth() {
  const health = await allRemoteSources();
  if (!health.ok) return resultEnvelope(health);
  const counts: Record<MediaKind, number> = { anime: 0, manga: 0, novel: 0 };
  for (const source of health.value) counts[source.kind]++;
  return resultEnvelope({ ok: true, value: { total: health.value.length, counts, sources: health.value } });
}

async function bootstrap(req: Request) {
  const profiles = allProfiles();
  const selected = profileFromHeaders(req.headers, profiles, false);
  const [health] = await Promise.all([sourceHealth()]);
  return apiOk({
    apiVersion: 1,
    server: { name: "Lacrima", version: packageJson.version },
    capabilities: {
      anime: true,
      manga: true,
      novels: true,
      profiles: true,
      sourceManagement: true,
      stickers: true,
      downloads: false,
    },
    profiles,
    selectedProfile: selected,
    settings: selected ? profileSettings(selected.id) : null,
    sourceHealth: health,
  });
}

async function home(req: Request) {
  const me = profile(req);
  const [catalog, health] = await Promise.all([fetchHome(topGenre(me.id)), sourceHealth()]);
  return apiOk({
    continue: continueReading(me.id),
    catalog: resultEnvelope(catalog),
    sourceHealth: health,
  });
}

async function browse(req: Request, path: string[]) {
  const me = profile(req);
  const kind = parseKind(path[1]);
  const url = new URL(req.url);
  const genreRaw = url.searchParams.get("genre");
  const genre = GENRES.includes(genreRaw as (typeof GENRES)[number]) ? genreRaw : null;
  const page = Math.max(1, Math.floor(Number(url.searchParams.get("page")) || 1));
  return resultResponse(await fetchBrowse(kind, genre, page, profileGenres(me.id)));
}

async function search(req: Request) {
  profile(req);
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (!q) throw new ApiFault(400, "query_required", "Search query is required.");
  return resultResponse(await fetchSearch(q));
}

async function title(req: Request, path: string[]) {
  const me = profile(req);
  const { via, kind, id } = titlePath(path);
  const url = new URL(req.url);
  const sourceQuery = url.searchParams.get("sourceQuery")?.trim() ?? "";
  const research = url.searchParams.get("change") === "1" || Boolean(sourceQuery);
  const part = url.searchParams.get("part");
  const seriesR = await fetchSeries(via, kind, id);
  const series = seriesR.ok && seriesR.value.parts.length ? seriesR.value : null;
  const canonical = series && series.rootId !== id ? { via, kind, id: series.rootId, part: id } : null;
  const baseMediaR = await fetchTitle(via, kind, id);
  if (!baseMediaR.ok) return resultResponse(baseMediaR);
  const baseMedia = baseMediaR.value;
  const allParts = series ? [...series.parts, ...series.specials] : [];
  const specials = part === "specials";
  const wanted = part == null && canonical ? id : Number(part);
  const selectedMeta = specials ? undefined : allParts.find((p) => p.id === wanted) ?? series?.parts[0];
  const selectedId = selectedMeta?.id ?? id;
  const selectedR = selectedId === id ? baseMediaR : await fetchTitle(via, kind, selectedId);
  const selected = selectedR.ok ? selectedR.value : baseMedia;
  const resolveMedia = selectedMeta?.kind === "special" || !series
    ? selected
    : { ...selected, title: series.title };
  const parts = series?.parts ?? [];
  const windowed = parts.length > 1 && selectedMeta?.kind !== "special";
  const partTitles = windowed
    ? await Promise.all(parts.map((p) => p.id === id ? baseMediaR : p.id === selectedId ? selectedR : fetchTitle(via, kind, p.id)))
    : [];
  const { offset, count } = windowed
    ? episodeWindow(parts.map((p, i) => ({ id: p.id, units: partTitles[i]?.ok ? partTitles[i].value.units : null })), selectedId)
    : { offset: 0, count: selectedMeta?.kind === "special" ? selected.units : null };
  const seasonHint = selectedMeta?.kind === "special"
    ? 0
    : Number(/^Season (\d+)$/i.exec(selectedMeta?.label ?? "")?.[1] ?? "") || null;
  const resolutionR = specials ? null : await resolveSource(resolveMedia, research, sourceQuery || undefined);
  const resolution = resolutionR?.ok ? resolutionR.value : null;
  const chaptersR = resolution?.binding ? await chaptersFor(resolution.binding) : null;
  const visibleChapters = chaptersR?.ok
    ? kind === "anime" && windowed
      ? windowEpisodes(chaptersR.value, offset, count, seasonHint)
      : chaptersR.value
    : null;
  const progress = getProgress(me.id, via, selectedId);
  const anchor = parseAnchor(progress?.anchor ?? null);
  return apiOk({
    canonical,
    media: baseMedia,
    selectedMedia: selected,
    heading: series?.title || seriesTitle(baseMedia.title),
    series: resultEnvelope(seriesR),
    selected: { id: selectedId, part: selectedMeta ?? null, specials, episodeOffset: offset, episodeCount: count, seasonHint },
    resolution: resolutionR ? resultEnvelope(resolutionR) : null,
    chapters: chaptersR
      ? chaptersR.ok
        ? { ok: true, data: visibleChapters }
        : resultEnvelope(chaptersR)
      : null,
    progress: progressDto(progress),
    library: getLibrary(me.id, via, selectedId) ?? null,
    resume: anchor && "chapterId" in anchor && anchor.chapterId != null
      ? { chapterId: String(anchor.chapterId), anchor }
      : null,
    progressTree: windowed ? progressTree(parts, selectedId, partTitles) : {},
  });
}

async function bindTitle(req: Request, path: string[]) {
  profile(req);
  const { via, kind, id } = titlePath(path);
  const body = await jsonObject(req);
  const sourceId = optionalString(body.sourceId);
  const sourceTitle = optionalString(body.sourceTitle);
  const sourceMangaId = optionalString(body.sourceMangaId);
  const confidence = finiteNumber(body.confidence);
  if (!sourceId || !sourceTitle || !sourceMangaId || confidence == null || confidence < 0 || confidence > 1) {
    throw new ApiFault(400, "missing_fields", "A source id, title, item id, and confidence from 0 to 1 are required.");
  }
  pinBinding({
    via,
    media_id: id,
    source_id: sourceId,
    source_title: sourceTitle,
    source_manga_id: sourceMangaId,
    confidence,
    backend: backend(kind).name.toLowerCase(),
    kind,
  });
  return apiOk({ binding: { via, mediaId: id, sourceId, sourceTitle, sourceMangaId, confidence, pinned: true, kind } });
}

function proxiedPage(url: string) {
  return `/api/proxy?url=${encodeURIComponent(url)}`;
}

async function reader(req: Request, path: string[]) {
  const me = profile(req);
  const { via, kind, id } = titlePath(path);
  if (kind === "anime") throw new ApiFault(400, "wrong_reader", "Use the playback endpoint for anime.");
  const chapterId = decodeURIComponent(path[4] ?? "");
  if (!chapterId) throw new ApiFault(400, "chapter_required", "Chapter id is required.");
  const binding = (await import("@/lib/match")).getBinding(via, id, kind);
  if (!binding) throw new ApiFault(409, "source_unbound", "This title is not bound to a source yet.");
  const [mediaR, chaptersR, pagesR] = await Promise.all([
    fetchTitle(via, kind, id),
    chaptersFor(binding),
    backend(kind).pages(chapterId, { via, mediaId: id }),
  ]);
  if (!mediaR.ok) return resultResponse(mediaR);
  if (!pagesR.ok) return resultResponse(pagesR);
  if (!pagesR.value.length) throw new ApiFault(404, "empty_chapter", "The source returned nothing for this chapter.");
  const chapters = chaptersR.ok ? chaptersR.value : [];
  const at = chapters.findIndex((c) => c.id === chapterId);
  const current = at >= 0 ? chapters[at] : null;
  const savedProgress = getProgress(me.id, via, id);
  const saved = parseAnchor(savedProgress?.anchor ?? null);
  const media = mediaR.value;
  const chapterName = current?.name ?? `Chapter ${chapterId}`;
  return apiOk({
    media,
    chapterId,
    chapter: current,
    chapters: resultEnvelope(chaptersR),
    previousChapterId: at > 0 ? chapters[at - 1].id : null,
    nextChapterId: at >= 0 && at + 1 < chapters.length ? chapters[at + 1].id : null,
    initialAnchor: saved && "chapterId" in saved && String(saved.chapterId) === chapterId ? saved : null,
    trackProgress: !savedProgress ||
      (saved && "chapterId" in saved && String(saved.chapterId) === chapterId) ||
      (at >= 0 && at + 1 > savedProgress.unit),
    content: kind === "novel"
      ? { type: "html", html: sanitizeNovelHtml(pagesR.value[0]) }
      : { type: "pages", urls: pagesR.value.map(proxiedPage) },
    progress: {
      via,
      mediaId: id,
      kind,
      title: media.title,
      cover: media.cover,
      unit: at >= 0 ? at + 1 : current?.number ?? 0,
      chapterId,
      chapterName,
      pages: kind === "manga" ? pagesR.value.length : null,
    },
    settings: profileSettings(me.id),
  });
}

async function playbackPlaylist(
  ctx: CacheCtx,
  title: string,
  lang: Lang | undefined,
  fresh: boolean,
) {
  const sources = await backend("anime").listSources();
  const installed = sources.ok ? new Set(sources.value.map((s) => s.name)) : null;
  const cached = fresh ? null : getCachedPick(ctx.via, ctx.mediaId, ctx.chapterId, lang);
  const pick = cached && (!installed || installed.has(cached.provider)) ? cached : null;
  const saved = fresh ? null : fromProviders(loadPlaylist(ctx), installed);
  if (saved) return { ok: true as const, value: forLang(saved, lang) };
  const resolved = await resolveStreams(ctx.chapterId, {
    via: ctx.via,
    mediaId: ctx.mediaId,
    title,
    lang,
    fresh,
  });
  if (resolved.ok) savePlaylist(ctx, resolved.value);
  if (resolved.ok) return resolved;
  if (pick) return { ok: true as const, value: fastPlaylist(pick) };
  return resolved;
}

function attemptsFor(
  group: StreamGroup,
  ctx: CacheCtx,
  seek: number,
  subtitle: Lang | undefined,
) {
  const wantedSubtitle = group.lang === "en" ? undefined : subtitle;
  const compatible = wantedSubtitle
    ? group.picks.filter((pick) => pick.subtitles?.includes(wantedSubtitle))
    : [];
  const { http, torrent } = splitPicks(compatible.length ? compatible : group.picks);
  const raw: { transport: string; pick: StreamPick }[] = [];
  for (let i = 0; i < http.length; i++) {
    const transport = mixedRaceUrl(http, torrent, i, 0) ?? http[i].url;
    raw.push({ transport, pick: http[i] });
  }
  for (let batch = 0; batch * TORRENT_RACE_MAX < torrent.length; batch++) {
    const transport = torrentRaceUrl(torrent, batch);
    const pick = torrent[batch * TORRENT_RACE_MAX];
    if (transport && pick) raw.push({ transport, pick });
  }
  const seen = new Set<string>();
  return raw.flatMap(({ transport, pick }) => {
    const url = remuxUrl(withCacheParams(transport, ctx), group.lang, seek, wantedSubtitle);
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [{ url, provider: pick.provider, commit: { groupId: group.id, pick } }];
  });
}

async function playback(req: Request, path: string[]) {
  const me = profile(req);
  const { via, kind, id } = titlePath(path);
  if (kind !== "anime") throw new ApiFault(400, "wrong_player", "Playback is only available for anime.");
  const chapterId = decodeURIComponent(path[4] ?? "");
  if (!chapterId) throw new ApiFault(400, "chapter_required", "Episode id is required.");
  const binding = (await import("@/lib/match")).getBinding(via, id, kind);
  if (!binding) throw new ApiFault(409, "source_unbound", "This title is not bound to a source yet.");
  const [mediaR, chaptersR, seriesR] = await Promise.all([
    fetchTitle(via, kind, id),
    chaptersFor(binding),
    fetchSeries(via, kind, id),
  ]);
  if (!mediaR.ok) return resultResponse(mediaR);
  if (!chaptersR.ok) return resultResponse(chaptersR);
  const episodes = chaptersR.value;
  const at = episodes.findIndex((c) => c.id === chapterId);
  const current = at >= 0 ? episodes[at] : null;
  const saved = parseAnchor(getProgress(me.id, via, id)?.anchor ?? null);
  const media = mediaR.value;
  const url = new URL(req.url);
  const settings = profileSettings(me.id);
  const lang = parseLang(url.searchParams.get("lang")) ?? settings.audio_lang;
  const subtitle = parseLang(url.searchParams.get("sub")) ??
    (settings.subtitle_lang === "off" ? undefined : "en");
  const initialTime = saved?.kind === "seconds" && saved.chapterId === chapterId ? saved.at : 0;
  const requestedSeek = url.searchParams.get("t");
  const seek = requestedSeek == null
    ? initialTime
    : Math.max(0, finiteNumber(requestedSeek) ?? 0);
  const playlistR = await playbackPlaylist(
    { via, mediaId: id, chapterId },
    media.title,
    lang,
    url.searchParams.get("fresh") === "1",
  );
  if (!playlistR.ok) return resultResponse(playlistR);
  const playlist: Playlist = playlistR.value;
  const seriesParts = seriesR.ok ? seriesR.value.parts : [];
  const partTitles = seriesParts.length > 1
    ? await Promise.all(seriesParts.map((p) => p.id === id ? mediaR : fetchTitle(via, kind, p.id)))
    : [];
  const progress = {
    via,
    mediaId: id,
    kind,
    title: media.title,
    cover: media.cover,
    unit: at >= 0 ? at + 1 : current?.number ?? 0,
    chapterId,
    chapterName: current?.name ?? `Episode ${current?.number ?? ""}`,
    season: current?.season,
    episode: current?.number,
    durationSeconds: media.unitMinutes ? media.unitMinutes * 60 : null,
    ...progressTree(seriesParts, id, partTitles),
  };
  const query = new URLSearchParams({ kind, chapterId, via, mediaId: String(id) });
  const next = at >= 0 ? episodes[at + 1] : undefined;
  return apiOk({
    media,
    chapterId,
    episode: current,
    episodes,
    previousEpisodeId: at > 0 ? episodes[at - 1].id : null,
    nextEpisodeId: next?.id ?? null,
    initialTime,
    durationSeconds: progress.durationSeconds,
    playlistUrl: `/api/play?${query}`,
    subtitlesUrl: `/api/v1/playback/${via}/${kind}/${id}/${encodeURIComponent(chapterId)}/subtitles`,
    nextPlaylistUrl: next
      ? `/api/play?${new URLSearchParams({ kind, chapterId: next.id, via, mediaId: String(id) })}`
      : null,
    nextPlaybackUrl: next
      ? `/api/v1/playback/${via}/${kind}/${id}/${encodeURIComponent(next.id)}`
      : null,
    streamGroups: playlist.groups.map((group) => ({
      id: group.id,
      quality: group.quality,
      lang: group.lang,
      label: group.label,
      attempts: attemptsFor(group, { via, mediaId: id, chapterId }, seek, subtitle),
    })),
    preferredStreamGroup: playlist.preferred,
    progress,
    settings,
  });
}

async function playbackSubtitles(req: Request, path: string[]) {
  profile(req);
  const { via, kind, id } = titlePath(path);
  if (kind !== "anime") throw new ApiFault(400, "wrong_player", "Subtitles are only available for anime.");
  const chapterId = decodeURIComponent(path[4] ?? "");
  if (!chapterId) throw new ApiFault(400, "chapter_required", "Episode id is required.");
  const subtitles = await resolveSubtitles(chapterId, {
    via,
    mediaId: id,
    fresh: new URL(req.url).searchParams.get("fresh") === "1",
  });
  if (!subtitles.ok) return resultResponse(subtitles);
  const ctx = { via, mediaId: id, chapterId };
  return apiOk({ subtitles: subtitles.value.map((cue) => ({ ...cue, src: fileHref(cue.url, ctx) })) });
}

/** Optional playback affordance: exact upstream markers, never duration-adjusted. */
async function playbackSkipTimes(req: Request, path: string[]) {
  profile(req);
  const { via, kind, id } = titlePath(path);
  if (kind !== "anime") throw new ApiFault(400, "wrong_player", "Skip markers are only available for anime.");
  const chapterId = decodeURIComponent(path[4] ?? "");
  if (!chapterId) throw new ApiFault(400, "chapter_required", "Episode id is required.");
  const binding = (await import("@/lib/match")).getBinding(via, id, kind);
  if (!binding) return apiOk({ segments: [] });
  const chapters = await chaptersFor(binding);
  if (!chapters.ok) return apiOk({ segments: [] });
  const episode = chapters.value.find((chapter) => chapter.id === chapterId)?.number;
  if (!Number.isInteger(episode) || !episode || episode < 1) return apiOk({ segments: [] });
  const result = await skipTimes({ via, mediaId: id, episode });
  return apiOk({ segments: result.ok ? result.value : [] });
}

async function playbackSubtitleBody(req: Request, path: string[]) {
  profile(req);
  const { via, kind, id } = titlePath(path);
  if (kind !== "anime") throw new ApiFault(400, "wrong_player", "Subtitles are only available for anime.");
  const chapterId = decodeURIComponent(path[4] ?? "");
  const body = await jsonObject(req);
  const wantId = optionalString(body.id);
  const wantUrl = optionalString(body.url);
  if (!chapterId || (!wantId && !wantUrl)) {
    throw new ApiFault(400, "missing_fields", "Episode and subtitle id are required.");
  }
  const subtitles = await resolveSubtitles(chapterId, { via, mediaId: id });
  if (!subtitles.ok) return resultResponse(subtitles);
  const cue =
    subtitles.value.find((c) => c.id === wantId) ??
    subtitles.value.find((c) => c.url === wantUrl);
  if (!cue) throw new ApiFault(404, "subtitle_not_found", "No such subtitle file.");
  const ctx = { via, mediaId: id, chapterId };
  let read = await readSubBody(ctx, cue.url);
  if (!read.buf && wantUrl && wantUrl !== cue.url) read = await readSubBody(ctx, wantUrl);
  if (!read.buf) {
    throw new ApiFault(502, "subtitle_unavailable", read.error || "Couldn't load that subtitle file.");
  }
  return apiOk({ text: decodeSubBytes(read.buf) });
}

async function playbackCommit(req: Request, path: string[]) {
  const me = profile(req);
  const { via, kind, id } = titlePath(path);
  if (kind !== "anime") throw new ApiFault(400, "wrong_player", "Playback is only available for anime.");
  const chapterId = decodeURIComponent(path[4] ?? "");
  const body = await jsonObject(req);
  const groupId = optionalString(body.groupId);
  const rawPick = body.pick;
  if (!chapterId || !groupId || !rawPick || typeof rawPick !== "object" || Array.isArray(rawPick)) {
    throw new ApiFault(400, "missing_fields", "Episode, stream group, and selected pick are required.");
  }
  const p = rawPick as Record<string, unknown>;
  const url = optionalString(p.url);
  const provider = optionalString(p.provider);
  if (!url?.startsWith("/api/stream?") || !provider) {
    throw new ApiFault(400, "invalid_pick", "Selected pick is not a Lacrima stream.");
  }
  const pick: StreamPick = {
    url,
    provider,
    ...(optionalString(p.hint) ? { hint: optionalString(p.hint) } : {}),
    ...(Array.isArray(p.subtitles)
      ? { subtitles: p.subtitles.flatMap((s) => parseLang(String(s)) ?? []).slice(0, 20) }
      : {}),
  };
  const committed = commitPick({ via, mediaId: id, chapterId }, groupId, pick);
  recordProviderChoice(me.id, provider);
  return apiOk({ committedAt: committed.committedAt, provider });
}

async function chaptersRefresh(req: Request, path: string[]) {
  profile(req);
  const { via, kind, id } = titlePath(path);
  const binding = (await import("@/lib/match")).getBinding(via, id, kind);
  if (!binding) throw new ApiFault(409, "source_unbound", "This title is not bound to a source yet.");
  return resultResponse(await chaptersFor(binding, true));
}

async function libraryGet(req: Request) {
  const me = profile(req);
  const url = new URL(req.url);
  backfillLibrary(me.id);
  const items = listLibrary(me.id);
  const kindRaw = url.searchParams.get("kind");
  const kind = kindRaw ? parseKind(kindRaw) : null;
  const status = parseStatus(url.searchParams.get("status"));
  const sort = parseSort(url.searchParams.get("sort"));
  const genre = url.searchParams.get("genre")?.trim() || null;
  const q = url.searchParams.get("q")?.trim() || null;
  const activity = loadActivity(me.id);
  return apiOk({
    items: sortLibrary(filterLibrary(items, { kind, status, sort, genre, q }), sort),
    total: items.length,
    shelf: shelfItems(items),
    genres: libraryGenres(items),
    facts: collectFacts(items, loadProgress(me.id), activity),
    monthMix: monthMix(activity),
    stickersEarned: earnedCount(me.id),
  });
}

async function libraryWrite(req: Request, remove = false) {
  const me = profile(req);
  const body = await jsonObject(req);
  if (Array.isArray(body.reorder)) {
    const keys = body.reorder.flatMap((raw) => {
      if (!raw || typeof raw !== "object") return [];
      const row = raw as Record<string, unknown>;
      try {
        return [{ via: parseProvider(optionalString(row.via)), id: positiveId(row.id) }];
      } catch {
        return [];
      }
    });
    reorderPins(me.id, keys);
    return apiOk({ reordered: true });
  }
  const via = parseProvider(optionalString(body.via));
  const kind = parseKind(optionalString(body.kind));
  const id = positiveId(body.id, "media id");
  if (remove || body.remove === true || body.status === "remove") {
    removeLibrary(me.id, via, id);
    return apiOk({ entry: null });
  }
  if (body.removeHistory === true) {
    removeHistory(me.id, via, id);
    return apiOk({ entry: null });
  }
  const title = optionalString(body.title);
  if (body.pin != null && !title) {
    const entry = setPinned(me.id, via, id, Boolean(body.pin));
    if (!entry) throw new ApiFault(404, "library_not_found", "Title is not in this profile's library.");
    return apiOk({ entry });
  }
  if (!title) throw new ApiFault(400, "missing_fields", "Title is required.");
  const genres = Array.isArray(body.genres) ? body.genres.filter((g): g is string => typeof g === "string") : [];
  const media = {
    via,
    id,
    kind,
    title,
    cover: nullableString(body.cover) ?? null,
    color: nullableString(body.color) ?? null,
    units: body.units === null ? null : finiteNumber(body.units) ?? null,
    genres,
  };
  const status = body.status == null ? undefined : parseStatus(String(body.status));
  if (body.status != null && !status) throw new ApiFault(400, "invalid_status", "Unknown library status.");
  const score = body.score === null ? null : finiteNumber(body.score);
  let entry = upsertLibrary(me.id, media, { status: status ?? undefined, ...(body.score === undefined ? {} : { score: score ?? null }) });
  if (body.pin != null) entry = setPinned(me.id, via, id, Boolean(body.pin)) ?? entry;
  return apiOk({ entry });
}

async function progressGet(req: Request) {
  const me = profile(req);
  const url = new URL(req.url);
  const via = parseProvider(url.searchParams.get("via"));
  const id = positiveId(url.searchParams.get("mediaId"), "media id");
  return apiOk({ progress: progressDto(getProgress(me.id, via, id)) });
}

async function progressPut(req: Request) {
  const me = profile(req);
  const body = await jsonObject(req);
  const via = parseProvider(optionalString(body.via));
  const kind = parseKind(optionalString(body.kind));
  const id = positiveId(body.mediaId, "media id");
  const title = optionalString(body.title);
  const unit = finiteNumber(body.unit);
  if (!title || unit == null || unit < 0) throw new ApiFault(400, "missing_fields", "Media title and a non-negative unit are required.");
  const cover = nullableString(body.cover) ?? null;
  const seriesParts = Array.isArray(body.seriesParts)
    ? body.seriesParts.flatMap((raw) => {
        if (!raw || typeof raw !== "object") return [];
        const row = raw as Record<string, unknown>;
        const mediaId = finiteNumber(row.mediaId);
        if (!mediaId || mediaId <= 0) return [];
        return [{
          mediaId: Math.floor(mediaId),
          title: optionalString(row.title) ?? title,
          cover: nullableString(row.cover) ?? null,
          units: Math.max(0, Math.floor(finiteNumber(row.units) ?? 0)),
        }];
      })
    : [];
  const stickers = await setProgressTree({
    profileId: me.id,
    media: { via, id, kind, title, cover },
    unit,
    anchor: anchorFrom(body.anchor),
    watchedDelta: finiteNumber(body.watchedDelta),
    skipAhead: Boolean(body.skipAhead),
    exact: Boolean(body.exact),
    durationSeconds: finiteNumber(body.durationSeconds),
    seriesParts,
    partIndex: finiteNumber(body.partIndex),
  });
  return apiOk({ progress: progressDto(getProgress(me.id, via, id)), stickers });
}

async function settingsGet(req: Request) {
  const me = profile(req);
  return apiOk({ settings: profileSettings(me.id), bestProviders: bestProviders(me.id) });
}

async function settingsPatch(req: Request) {
  const me = profile(req);
  const body = await jsonObject(req);
  return apiOk({ settings: updateProfileSettings(me.id, body as Partial<Settings>) });
}

async function profilesGet() {
  return apiOk({ profiles: allProfiles() });
}

async function profilesPost(req: Request) {
  const body = await jsonObject(req);
  const name = optionalString(body.name);
  if (!name) throw new ApiFault(400, "name_required", "Profile name is required.");
  const accent = body.accent === undefined ? ACCENTS[0] : parseHex(String(body.accent));
  if (!accent) throw new ApiFault(400, "invalid_profile", "Accent must be a hex colour.");
  const created = createProfile(name, accent as typeof ACCENTS[0]);
  if ("error" in created) throw new ApiFault(400, "invalid_profile", created.error);
  return apiOk({ profile: created }, 201);
}

async function profilesPatch(req: Request) {
  const body = await jsonObject(req);
  const id = profile(req).id;
  if (body.id != null && positiveId(body.id, "profile id") !== id) {
    throw new ApiFault(403, "profile_mismatch", "The profile header must match the profile being updated.");
  }
  const updated = updateProfile(id, {
    ...(body.name === undefined ? {} : { name: String(body.name) }),
    ...(body.accent === undefined ? {} : { accent: String(body.accent) }),
    ...(body.avatar_color === undefined ? {} : { avatar_color: String(body.avatar_color) }),
    ...(body.wallpaper === undefined ? {} : { wallpaper: body.wallpaper === null ? null : String(body.wallpaper) }),
  });
  if ("error" in updated) throw new ApiFault(400, "invalid_profile", updated.error);
  return apiOk({ profile: updated });
}

async function profilesDelete(req: Request) {
  const body = await jsonObject(req);
  const id = profile(req).id;
  if (body.id != null && positiveId(body.id, "profile id") !== id) {
    throw new ApiFault(403, "profile_mismatch", "The profile header must match the profile being deleted.");
  }
  const removed = deleteProfile(id);
  if ("error" in removed) throw new ApiFault(400, "profile_not_deleted", removed.error);
  return apiOk({ deleted: id });
}

function sourceKind(req: Request, body?: Record<string, unknown>) {
  return parseKind(optionalString(body?.kind) ?? new URL(req.url).searchParams.get("kind"));
}

async function sourcesGet(req: Request) {
  const kind = sourceKind(req);
  const r = await backend(kind).listSources();
  if (!r.ok) return resultResponse(r);
  const disabled = disabledIds(kind);
  return apiOk({ sources: r.value.map((s) => ({ ...s, enabled: !disabled.has(s.id) })) });
}

async function sourcesPatch(req: Request) {
  const body = await jsonObject(req);
  const kind = sourceKind(req, body);
  const id = optionalString(body.id);
  if (!id || typeof body.enabled !== "boolean") throw new ApiFault(400, "missing_fields", "Source id and enabled are required.");
  if (kind === "manga") setSourceDisabled(kind, id, !body.enabled);
  else {
    const r = await backend(kind).setExtensionInstalled(id, body.enabled);
    if (!r.ok) return resultResponse(r);
  }
  clearSourceHealth();
  return apiOk({ id, kind, enabled: body.enabled });
}

async function reposGet(req: Request) {
  return resultResponse(await backend(sourceKind(req)).listRepos());
}

async function reposPost(req: Request) {
  const body = await jsonObject(req);
  const kind = sourceKind(req, body);
  const indexUrl = optionalString(body.indexUrl);
  if (!indexUrl) throw new ApiFault(400, "url_required", "Repository index URL is required.");
  const added = await backend(kind).addRepo(indexUrl);
  if (!added.ok) return resultResponse(added);
  const refreshed = await backend(kind).refreshExtensions();
  clearSourceHealth();
  return apiOk({ indexUrl, kind, refreshed: resultEnvelope(refreshed) }, 201);
}

async function reposDelete(req: Request) {
  const body = await jsonObject(req);
  const kind = sourceKind(req, body);
  const indexUrl = optionalString(body.indexUrl);
  if (!indexUrl) throw new ApiFault(400, "url_required", "Repository index URL is required.");
  const r = await backend(kind).removeRepo(indexUrl);
  clearSourceHealth();
  return resultResponse(r);
}

async function reposRefresh(req: Request) {
  const body = await jsonObject(req);
  const r = await backend(sourceKind(req, body)).refreshExtensions();
  clearSourceHealth();
  return resultResponse(r);
}

async function extensionsGet(req: Request) {
  const url = new URL(req.url);
  const r = await backend(sourceKind(req)).listExtensions(url.searchParams.get("q")?.trim() ?? "");
  if (!r.ok) return resultResponse(r);
  const limit = Math.min(200, Math.max(1, Math.floor(Number(url.searchParams.get("limit")) || 100)));
  return apiOk({ extensions: r.value.slice(0, limit), total: r.value.length, truncated: r.value.length > limit });
}

async function extensionsPatch(req: Request) {
  const body = await jsonObject(req);
  const kind = sourceKind(req, body);
  const pkgName = optionalString(body.pkgName);
  if (!pkgName || typeof body.installed !== "boolean") throw new ApiFault(400, "missing_fields", "Extension id and installed are required.");
  const r = await backend(kind).setExtensionInstalled(pkgName, body.installed);
  clearSourceHealth();
  return resultResponse(r);
}

async function stickersGet(req: Request) {
  const me = profile(req);
  const collection = await collectionFor(me.id, listLibrary(me.id));
  return apiOk({ collection, earned: earnedCatalog(me.id), earnedCount: earnedCount(me.id) });
}

async function stickersPatch(req: Request) {
  const me = profile(req);
  const body = await jsonObject(req);
  const id = optionalString(body.id);
  if (!id) throw new ApiFault(400, "id_required", "Sticker id is required.");
  const sticker = toggleSticker(me.id, id);
  if (!sticker) throw new ApiFault(404, "sticker_not_found", "Unknown sticker.");
  return apiOk({ sticker });
}

async function placementsGet(req: Request) {
  const me = profile(req);
  const url = new URL(req.url);
  return apiOk({ placements: listPlacements(me.id, url.searchParams.get("path") ?? "", url.searchParams.get("surface") ?? undefined) });
}

async function placementsPost(req: Request) {
  const me = profile(req);
  const body = await jsonObject(req);
  const stickerId = optionalString(body.stickerId);
  const path = optionalString(body.path);
  const x = finiteNumber(body.x);
  const y = finiteNumber(body.y);
  if (!stickerId || !path || x == null || y == null) throw new ApiFault(400, "missing_fields", "Sticker, path, x, and y are required.");
  const placement = addPlacement(me.id, { stickerId, path, x, y, scale: finiteNumber(body.scale) ?? 1, rot: finiteNumber(body.rot), surface: optionalString(body.surface) });
  if (!placement) throw new ApiFault(400, "cannot_place", "Sticker cannot be placed there.");
  return apiOk({ placement }, 201);
}

async function placementsPatch(req: Request) {
  const me = profile(req);
  const body = await jsonObject(req);
  const id = positiveId(body.id, "placement id");
  const placement = movePlacement(me.id, id, {
    x: finiteNumber(body.x),
    y: finiteNumber(body.y),
    scale: finiteNumber(body.scale),
    rot: finiteNumber(body.rot),
    path: optionalString(body.path),
  });
  if (!placement) throw new ApiFault(404, "placement_not_found", "No such placement.");
  return apiOk({ placement });
}

async function placementsDelete(req: Request) {
  const me = profile(req);
  const body = await jsonObject(req);
  const id = positiveId(body.id, "placement id");
  if (!removePlacement(me.id, id)) throw new ApiFault(404, "placement_not_found", "No such placement.");
  return apiOk({ deleted: id });
}

async function dispatch(method: string, req: Request, path: string[]): Promise<Response> {
  const key = path[0];
  if (method === "GET") {
    if (key === "bootstrap" && path.length === 1) return bootstrap(req);
    if (key === "profiles" && path.length === 1) return profilesGet();
    if (key === "home" && path.length === 1) return home(req);
    if (key === "browse" && path.length === 2) return browse(req, path);
    if (key === "search" && path.length === 1) return search(req);
    if (key === "titles" && path.length === 4) return title(req, path);
    if (key === "reader" && path.length === 5) return reader(req, path);
    if (key === "playback" && path.length === 5) return playback(req, path);
    if (key === "playback" && path.length === 6 && path[5] === "skip-times") return playbackSkipTimes(req, path);
    if (key === "playback" && path.length === 6 && path[5] === "subtitles") return playbackSubtitles(req, path);
    if (key === "library" && path.length === 1) return libraryGet(req);
    if (key === "progress" && path.length === 1) return progressGet(req);
    if (key === "settings" && path.length === 1) return settingsGet(req);
    if (key === "sources" && path[1] === "health") return Response.json(await sourceHealth());
    if (key === "sources" && path[1] === "repos") return reposGet(req);
    if (key === "sources" && path[1] === "extensions") return extensionsGet(req);
    if (key === "sources" && path.length === 1) return sourcesGet(req);
    if (key === "stickers" && path[1] === "placements") return placementsGet(req);
    if (key === "stickers" && path.length === 1) return stickersGet(req);
  }
  if (method === "POST") {
    if (key === "profiles" && path.length === 1) return profilesPost(req);
    if (key === "library" && path.length === 1) return libraryWrite(req);
    if (key === "progress" && path.length === 1) return progressPut(req);
    if (key === "titles" && path.length === 6 && path[4] === "chapters" && path[5] === "refresh") return chaptersRefresh(req, path);
    if (key === "playback" && path.length === 6 && path[5] === "commit") return playbackCommit(req, path);
    if (key === "playback" && path.length === 7 && path[5] === "subtitles" && path[6] === "body") {
      return playbackSubtitleBody(req, path);
    }
    if (key === "sources" && path[1] === "repos" && path[2] === "refresh") return reposRefresh(req);
    if (key === "sources" && path[1] === "repos") return reposPost(req);
    if (key === "stickers" && path[1] === "placements") return placementsPost(req);
  }
  if (method === "PUT") {
    if (key === "titles" && path.length === 5 && path[4] === "binding") return bindTitle(req, path);
    if (key === "library" && path.length === 1) return libraryWrite(req);
    if (key === "progress" && path.length === 1) return progressPut(req);
    if (key === "settings" && path.length === 1) return settingsPatch(req);
  }
  if (method === "PATCH") {
    if (key === "profiles" && path.length === 1) return profilesPatch(req);
    if (key === "settings" && path.length === 1) return settingsPatch(req);
    if (key === "sources" && path[1] === "extensions") return extensionsPatch(req);
    if (key === "sources" && path.length === 1) return sourcesPatch(req);
    if (key === "stickers" && path[1] === "placements") return placementsPatch(req);
    if (key === "stickers" && path.length === 1) return stickersPatch(req);
  }
  if (method === "DELETE") {
    if (key === "profiles" && path.length === 1) return profilesDelete(req);
    if (key === "library" && path.length === 1) return libraryWrite(req, true);
    if (key === "sources" && path[1] === "repos") return reposDelete(req);
    if (key === "stickers" && path[1] === "placements") return placementsDelete(req);
  }
  return apiError(404, "not_found", "No such API endpoint.");
}

async function handle(method: string, req: Request, ctx: Context) {
  try {
    return await dispatch(method, req, await pathOf(ctx));
  } catch (error) {
    if (error instanceof ApiFault) return apiError(error.status, error.code, error.message);
    console.error("Lacrima API error", error);
    return apiError(500, "internal_error", "The server could not complete this request.");
  }
}

export const GET = (req: Request, ctx: Context) => handle("GET", req, ctx);
export const POST = (req: Request, ctx: Context) => handle("POST", req, ctx);
export const PUT = (req: Request, ctx: Context) => handle("PUT", req, ctx);
export const PATCH = (req: Request, ctx: Context) => handle("PATCH", req, ctx);
export const DELETE = (req: Request, ctx: Context) => handle("DELETE", req, ctx);
