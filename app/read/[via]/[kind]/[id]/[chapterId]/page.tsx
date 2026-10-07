import Link from "next/link";
import { notFound } from "next/navigation";
import NovelReader from "@/components/NovelReader";
import Player from "@/components/Player";
import Reader from "@/components/Reader";
import { sanitizeNovelHtml } from "@/lib/api/sanitize";
import { nativeLang } from "@/lib/audio";
import { getBinding } from "@/lib/match";
import { isVideoKind } from "@/lib/kinds";
import { fetchTitle, parseTitleRoute } from "@/lib/metadata";
import { nextPlayable, titleBackHref } from "@/lib/nav";
import { paragraphIndex } from "@/lib/novel-html";
import { currentProfile } from "@/lib/profile";
import { profileSettings, readerSettings, subtitleChoice } from "@/lib/settings";
import type { ProgressWrite } from "@/lib/progress-write";
import { getProgress, parseAnchor } from "@/lib/progress";
import { loadPlaylist } from "@/lib/play-cache";
import { bindingForPlayback, chaptersFor } from "@/lib/resolve";
import { backend } from "@/lib/sources";
import { resolveStreams } from "@/lib/sources/stremio";
import { fetchSeries, progressTree } from "@/lib/series";
import { DEFAULT_NOVEL_READER } from "@/lib/reader-prefs";

export const dynamic = "force-dynamic";

const proxied = (u: string) => `/api/proxy?url=${encodeURIComponent(u)}`;

function Dead({ back, reason }: { back: string; reason: string }) {
  return (
    <div className="reader">
      <header className="reader-bar">
        <Link className="rbtn" href={back}>
          ←
        </Link>
        <div className="reader-id">
          <b>Can&apos;t open this</b>
        </div>
      </header>
      <div className="reader-stage">
        <div className="empty" style={{ maxWidth: 460 }}>
          <b>Nothing to show</b>
          {reason} Your progress and library are untouched — try another chapter, or
          pick a different source on the title page.
        </div>
      </div>
    </div>
  );
}

export default async function Read({
  params,
  searchParams,
}: {
  params: Promise<{ via: string; kind: string; id: string; chapterId: string }>;
  searchParams: Promise<{ end?: string | string[] }>;
}) {
  const p = await params;
  const end = (await searchParams).end === "1";
  const route = parseTitleRoute(p.via, p.kind, p.id);
  if (!route) notFound();
  const { via, kind, id: mediaId } = route;
  const video = isVideoKind(kind);
  const chapterId = decodeURIComponent(p.chapterId);
  let back = `/title/${via}/${kind}/${mediaId}`;
  const src = backend(kind);

  /* Memoised by fetchTitle, so every later call below joins this one. */
  const mediaP = fetchTitle(via, kind, mediaId);
  /* A movie or series is bound by its IMDb id, which only metadata knows, so only a pinned
     binding may skip that wait: an unpinned stored one is an old search result that the
     id outranks (the title page does the same, see `bindingForPlayback`). */
  const stored = getBinding(via, mediaId, kind);
  const binding =
    stored && (stored.pinned || (kind !== "movie" && kind !== "series"))
      ? stored
      : await mediaP.then((m) => (m.ok ? bindingForPlayback(m.value) : (stored ?? null)));
  if (!binding) {
    return (
      <Dead
        back={back}
        reason={
          kind === "movie" || kind === "series"
            ? "No installed source can stream this title. Add a repository in Sources."
            : "This title is not bound to a source yet."
        }
      />
    );
  }

  /* Asking every addon for this episode costs seconds to half a minute, and it used
     to start only once the browser had shipped, parsed and hydrated the player. It
     is the same work either way, so start it here and let it run under the render;
     `resolveStreams` dedupes, so the player's own request joins this one. */
  if (video && !loadPlaylist({ via, mediaId, chapterId })) {
    void mediaP
      .then((t) =>
        resolveStreams(chapterId, {
          via,
          mediaId,
          kind,
          title: t.ok ? t.value.title : undefined,
          native: nativeLang(kind, t.ok ? t.value.language : undefined),
        }),
      )
      .catch(() => undefined);
  }

  const [media, list, pages, me, seriesR] = await Promise.all([
    mediaP,
    chaptersFor(binding),
    video ? null : src.pages(chapterId, { via, mediaId }),
    currentProfile(),
    fetchSeries(via, kind, mediaId),
  ]);
  const settings = profileSettings(me.id);
  const savedSub = video ? subtitleChoice(me.id, via, mediaId, chapterId) : null;

  back = titleBackHref(via, kind, mediaId, seriesR.ok ? seriesR.value : null);

  if (!media.ok) return <Dead back={back} reason={media.reason} />;
  const m = media.value;
  const seriesParts = seriesR.ok ? seriesR.value.parts : [];
  const partTitles =
    kind === "anime" && seriesParts.length > 1
      ? await Promise.all(
          seriesParts.map((p) => (p.id === mediaId ? media : fetchTitle(via, kind, p.id))),
        )
      : [];
  const tree = kind === "anime" ? progressTree(seriesParts, mediaId, partTitles) : {};

  if (pages && !pages.ok) return <Dead back={back} reason={pages.reason} />;
  if (pages && pages.value.length === 0) {
    return <Dead back={back} reason="The source returned nothing for this chapter." />;
  }

  const chapters = list.ok ? list.value : [];
  const at = chapters.findIndex((c) => c.id === chapterId);
  const here = at >= 0 ? chapters[at] : null;
  const hop = (i: number) =>
    i >= 0 && i < chapters.length
      ? `/read/${via}/${kind}/${mediaId}/${encodeURIComponent(chapters[i].id)}`
      : null;

  const savedProgress = getProgress(me.id, via, mediaId);
  const anchor = parseAnchor(savedProgress?.anchor ?? null);
  const trackProgress = !savedProgress ||
    (anchor && "chapterId" in anchor && String(anchor.chapterId) === chapterId) ||
    (at >= 0 && at + 1 > savedProgress.unit);
  const initialPage =
    end && pages?.ok
      ? pages.value.length - 1
      : anchor?.kind === "page" && String(anchor.chapterId) === chapterId
        ? anchor.index
        : 0;
  const initialParagraph =
    end
      ? Number.MAX_SAFE_INTEGER
      : anchor?.kind === "paragraph" && String(anchor.chapterId ?? "") === chapterId
        ? paragraphIndex(anchor.cfi)
        : 0;
  const initialTime =
    anchor?.kind === "seconds" && String(anchor.chapterId) === chapterId ? anchor.at : 0;

  const chapterLabel =
    kind === "movie"
      ? (m.year ? String(m.year) : "Movie")
      : here
        ? video
          ? `${here.season && here.season > 0 ? `S${here.season} · ` : ""}E${here.number} · ${here.name}`
          : `${here.name}${here.scanlator ? ` · ${here.scanlator}` : ""}`
        : video
          ? "Episode"
          : `Chapter ${chapterId}`;

  const progress: ProgressWrite = {
    via: m.via,
    mediaId: m.id,
    kind: m.kind,
    title: m.title,
    cover: m.cover,
    unit: at >= 0 ? at + 1 : (here?.number ?? 0),
    chapterId,
    chapterName:
      here?.name ??
      (video ? `Episode ${here?.number ?? ""}` : `Chapter ${chapterId}`),
    season: here?.season,
    episode: here?.number,
    durationSeconds: m.unitMinutes ? m.unitMinutes * 60 : null,
    pages: pages?.ok ? pages.value.length : null,
    ...tree,
  };

  if (video) {
    /* A film or show opens in the language it was made in; the profile's audio setting
       is an anime preference (sub or dub) and has no say over Shawshank. */
    const native = nativeLang(kind, m.language);
    const live = kind === "movie" || kind === "series";
    const playFor = (cid: string) =>
      `/api/play?${new URLSearchParams({ kind, chapterId: cid, via, mediaId: String(mediaId) })}`;
    /* Resolving an episode costs ~28s the first time and is cached after, so the
       next one is resolved while this one plays: by the time the credits roll it
       is already warm. This is the whole reason "next" feels instant. */
    const upNext = nextPlayable(kind, chapters, chapterId);
    return (
      <Player
        key={`${via}:${mediaId}:${chapterId}`}
        savedSub={savedSub}
        title={m.title}
        episodeLabel={chapterLabel}
        backHref={back}
        nextHref={upNext ? hop(at + 1) : null}
        nextLabel={
          upNext
            ? `${upNext.season && upNext.season > 0 ? `S${upNext.season} · ` : ""}E${upNext.number} · ${upNext.name}`
            : null
        }
        episodes={chapters.map((c) => ({
          id: c.id,
          number: c.number,
          name: c.name,
          season: c.season ?? null,
          href: `/read/${via}/${kind}/${mediaId}/${encodeURIComponent(c.id)}`,
        }))}
        currentId={chapterId}
        playUrl={playFor(chapterId)}
        warmUrl={upNext ? playFor(upNext.id) : null}
        initialTime={initialTime}
        durationSeconds={m.unitMinutes ? m.unitMinutes * 60 : null}
        progress={progress}
        settings={live ? { ...settings, audio_lang: native } : settings}
        nativeLang={native}
      />
    );
  }

  if (!pages?.ok) return <Dead back={back} reason="Nothing to show." />;

  if (kind === "novel") {
    return (
      <NovelReader
        html={sanitizeNovelHtml(pages.value[0])}
        initialParagraph={initialParagraph}
        title={m.title}
        chapterLabel={chapterLabel}
        backHref={back}
        prevHref={at >= 0 ? hop(at - 1) : null}
        nextHref={at >= 0 ? hop(at + 1) : null}
        progress={progress}
        trackProgress={trackProgress}
        settingsKey={`${m.via}:${m.id}`}
        defaults={DEFAULT_NOVEL_READER}
        chapters={chapters.map((c) => ({
          id: c.id,
          number: c.number,
          name: c.name,
          season: c.season ?? null,
          href: `/read/${via}/${kind}/${mediaId}/${encodeURIComponent(c.id)}`,
        }))}
        currentId={chapterId}
      />
    );
  }

  return (
    <Reader
      pages={pages.value.map(proxied)}
      initialPage={initialPage}
      title={m.title}
      chapterLabel={chapterLabel}
      backHref={back}
      prevHref={at >= 0 ? hop(at - 1) : null}
      nextHref={at >= 0 ? hop(at + 1) : null}
      progress={progress}
      trackProgress={trackProgress}
      settingsKey={`${m.via}:${m.id}`}
      defaults={readerSettings(settings)}
      chapters={chapters.map((c) => ({
        id: c.id,
        number: c.number,
        name: c.name,
        season: c.season ?? null,
        href: `/read/${via}/${kind}/${mediaId}/${encodeURIComponent(c.id)}`,
      }))}
      currentId={chapterId}
    />
  );
}
