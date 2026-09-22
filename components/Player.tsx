"use client";

import PlayerMeta from "@/components/PlayerMeta";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
} from "react";
import { LANGS, pickAudioTrack, type Lang } from "@/lib/audio";
import {
  cueAt,
  cueByChoice,
  fileHref,
  parseCues,
  parseSubSync,
  pickSubLang,
  remuxEpisodeTime,
  SUB_SYNC_RANGE,
  SUB_SYNC_STEP,
  subSyncKey,
  captionScaleLabel,
  CAPTION_SCALES,
  type SubChoice,
  type SubCue,
  type TimedCue,
} from "@/lib/subs";
import { pushProgress, usesSeriesTree, type ProgressWrite } from "@/lib/progress-write";
import { withCacheParams } from "@/lib/play-cache-client";
import { nextUpCountdown, toggleSubChoice } from "@/lib/nextup";
import { dockSeasons, type DockEpisode } from "@/lib/nav";
import {
  bufferedEnd,
  fmtClock,
  fmtRemaining,
  jumpPercent,
  planSeek,
  scrubPercents,
} from "@/lib/seek";
import {
  browserPlayable,
  isMixedRaceUrl,
  isTorrentRaceUrl,
  mixedRaceUrl,
  remuxUrl,
  splitPicks,
  srcDeadlineMs,
  TORRENT_RACE_MAX,
  torrentRaceUrl,
  withRaceTry,
  langChoices,
  qualitiesForLang,
  type StreamGroup,
} from "@/lib/streams";
import { mseSupported, useMseSrc } from "@/components/useMseSrc";
import { useRouter } from "next/navigation";
import {
  Controls,
  Gesture,
  MediaPlayer,
  MediaProvider,
  MuteButton,
  PlayButton,
  VolumeSlider,
  isHLSProvider,
  useMediaState,
  type MediaPlayerInstance,
  type MediaProviderAdapter,
  type MediaSrc,
} from "@vidstack/react";

const langLabel = (id: Lang) => LANGS.find((l) => l.id === id)?.label ?? id;

type SkipSegment = { type: "op" | "ed" | "mixed-op" | "mixed-ed" | "recap"; start: number; end: number };

const skipLabel = (type: SkipSegment["type"]) =>
  type === "op" ? "Opening" : type === "ed" ? "Ending" : type === "recap" ? "Recap" :
    type === "mixed-op" ? "Mixed opening" : "Mixed ending";

function Icon({ d, filled = true }: { d: string; filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      aria-hidden="true"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={filled ? undefined : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

const PATH = {
  play: "M8 5.5v13l11-6.5z",
  pause: "M7 5.5h3.2v13H7zm6.8 0H17v13h-3.2z",
  back10: "M12 6V3L7 7l5 4V8a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z",
  fwd10: "M12 6V3l5 4-5 4V8a5 5 0 1 0 5 5h2a7 7 0 1 1-7-7z",
  next: "M6 5.5v13l9-6.5zM16.5 5.5H19v13h-2.5z",
  list: "M4 7h16M4 12h16M4 17h16",
  vol: "M4 9.5h3L11 6v12L7 14.5H4zm10.5-1a4.5 4.5 0 0 1 0 7",
  mute: "M4 9.5h3L11 6v12L7 14.5H4zm11 0 4 5m0-5-4 5",
  full: "M4 9V4h5M20 9V4h-5M4 15v5h5m11-5v5h-5",
  arrow: "M14 6l-6 6 6 6",
};

/** A relayed URL has no extension left, so the resolver flags HLS for us. */
function sourceFor(url: string): MediaSrc {
  if (url.startsWith("blob:")) return { src: url, type: "video/mp4" };
  const q = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  const hls = new URLSearchParams(q).get("hls") === "1";
  return { src: url, type: hls ? "application/x-mpegurl" : "video/mp4" };
}

function listedTracks(p: MediaPlayerInstance | null) {
  const list = p?.audioTracks;
  if (!list) return [];
  const out: { language?: string; label?: string }[] = [];
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (t) out.push({ language: t.language, label: t.label });
  }
  return out;
}

/* hls.js ships with the app rather than loading off JSDelivr: this runs on a private
   network, and a player that needs the public internet to start is not self-hosted. */
function useLocalHls() {
  return useCallback((provider: MediaProviderAdapter | null) => {
    if (isHLSProvider(provider)) provider.library = () => import("hls.js");
  }, []);
}

function IconBtn({ className, ...props }: ComponentProps<"button">) {
  return <button type="button" className={`pbtn${className ? ` ${className}` : ""}`} {...props} />;
}

function SubOverlay({ cues, at, scale }: { cues: TimedCue[]; at: number; scale: number }) {
  const cue = cueAt(cues, at);
  if (!cue) return null;
  return (
    <div className="player-captions" style={{ "--caption-scale": scale } as CSSProperties} aria-live="off">
      {cue.text}
    </div>
  );
}

/** Only shown while nothing is watchable, so it can never sit over moving video. */
function Wait({ finding }: { finding: string | null }) {
  const canPlay = useMediaState("canPlay");
  const waiting = useMediaState("waiting");
  if (canPlay && !waiting) return null;
  const label = canPlay ? "Buffering" : (finding ?? "Loading");
  return (
    <div className="player-wait">
      <span className="spin" />
      {label}
    </div>
  );
}

/** A live remux has no native duration/ranges, so seeking restarts it at this time. */
function RemuxTimeline({
  position,
  duration,
  buffered,
  segments,
  onSeek,
}: {
  position: number;
  duration: number | null;
  buffered: number;
  segments: SkipSegment[];
  onSeek: (seconds: number) => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const shown = Math.min(duration ?? position, draft ?? position);
  const fill = duration ? `${(shown / duration) * 100}%` : "0%";
  const buf = duration ? `${Math.max(shown / duration, buffered) * 100}%` : "0%";

  if (!duration) {
    return <span className="player-remain">{fmtClock(position)}</span>;
  }

  const commit = (value: string) => {
    const next = Number(value);
    if (!Number.isFinite(next)) return;
    setDraft(null);
    onSeek(next);
  };

  return (
    <>
      <div
        className="scrub-v"
        style={{ "--slider-fill": fill, "--slider-progress": buf } as CSSProperties}
      >
        <div className="scrub-track">
          <div className="scrub-buf" />
          <div className="scrub-fill" />
        </div>
        <span className="scrub-thumb" />
        {segments.flatMap((segment) => [
          { at: segment.start, edge: "starts" },
          { at: segment.end, edge: "ends" },
        ]).map(({ at, edge }, index) => (
          <button
            key={`${index}:${at}`}
            type="button"
            className="skip-marker"
            style={{ "--marker-at": `${(at / duration) * 100}%` } as CSSProperties}
            aria-label={`Seek to ${skipLabel(segments[Math.floor(index / 2)].type)} ${edge}`}
            title={`${skipLabel(segments[Math.floor(index / 2)].type)} ${edge}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onSeek(at)}
          />
        ))}
        <input
          className="remux-range"
          type="range"
          min={0}
          max={duration}
          step="any"
          value={shown}
          aria-label="Seek"
          onChange={(e) => setDraft(Number(e.currentTarget.value))}
          onPointerUp={(e) => commit(e.currentTarget.value)}
          onKeyUp={(e) => {
            if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(e.key)) {
              commit(e.currentTarget.value);
            }
          }}
        />
      </div>
      <span className="player-remain">{fmtRemaining(duration, shown)}</span>
    </>
  );
}

export default function Player({
  title,
  episodeLabel,
  backHref,
  nextHref,
  nextLabel,
  episodes = [],
  currentId,
  playUrl,
  warmUrl,
  initialTime,
  durationSeconds,
  progress,
  settings,
}: {
  title: string;
  episodeLabel: string;
  backHref: string;
  nextHref: string | null;
  nextLabel?: string | null;
  episodes?: DockEpisode[];
  currentId?: string;
  playUrl: string;
  warmUrl?: string | null;
  initialTime: number;
  durationSeconds: number | null;
  progress: ProgressWrite;
  settings: { audio_lang: Lang; subtitle_lang: string; caption_scale: number };
}) {
  const router = useRouter();
  const player = useRef<MediaPlayerInstance>(null);
  const onProviderChange = useLocalHls();

  /** Groups are quality × language. Failover walks urls inside the chosen group. */
  const [groups, setGroups] = useState<StreamGroup[]>([]);
  const [gid, setGid] = useState<string | null>(null);
  /** HTTP picks are tried one at a time; torrent picks in a bucket are raced together. */
  const [httpAt, setHttpAt] = useState(0);
  const [torrentBatch, setTorrentBatch] = useState(0);
  /** Next warm torrent in the same race batch before advancing to the next batch. */
  const [raceTry, setRaceTry] = useState(0);
  /* Where this remux begins. Resuming starts here; a seek restarts ffmpeg here. */
  const [startAt, setStartAt] = useState(initialTime);
  const [position, setPosition] = useState(initialTime);
  const [err, setErr] = useState<string | null>(null);
  /* Read on the first render, not from an effect: gating the resolve request on a
     mount effect meant the slowest request in the app waited for hydration first.
     Nothing language-dependent is rendered before the playlist lands, so the
     server's "ja" and the browser's saved value cannot disagree on screen. */
  const [lang, setLang] = useState<Lang>(() =>
    settings.audio_lang,
  );
  /** Cached fast-path only returns one pick; bust it when that pick won't start. */
  const [bustCache, setBustCache] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [sourceProvider, setSourceProvider] = useState<string | null>(null);
  const [revealKey, setRevealKey] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  /** Dismissed per episode: it is news the first time, nagging by the third. */
  const [langNoteOff, setLangNoteOff] = useState(false);
  const [clockDuration, setClockDuration] = useState(durationSeconds);
  const [bufferedPct, setBufferedPct] = useState(0);
  const [ended, setEnded] = useState(false);
  const [nextCancelled, setNextCancelled] = useState(false);
  const [skipSegments, setSkipSegments] = useState<SkipSegment[]>([]);
  const [cues, setCues] = useState<SubCue[]>([]);
  const [subErr, setSubErr] = useState<string | null>(null);
  const [subLoading, setSubLoading] = useState(true);
  const [subFresh, setSubFresh] = useState(0);
  const [subLang, setSubLang] = useState<SubChoice>(() =>
    settings.subtitle_lang,
  );
  const [captionScale, setCaptionScale] = useState(() =>
    settings.caption_scale,
  );
  /* MediaSource exists only in the browser. Wait one mount so SSR and the
     first client paint agree, then take the remux ourselves instead of
     handing Chrome a live pipe it will drop on pause. */
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  /** Where to pick up: the saved anchor at first, then wherever we actually got to. */
  const resume = useRef(initialTime);
  /** Absolute time at the last pause. Play after a remux reset has to restart here. */
  const pausedAt = useRef<number | null>(null);
  const native = useRef(false);
  const seeded = useRef<string | null>(null);
  const committed = useRef<string | null>(null);
  const warmed = useRef(false);
  const playedFor = useRef(0);
  const pendingWatch = useRef(0);
  const lastWall = useRef(Date.now());
  const lastSub = useRef<string | null>(
    typeof window === "undefined" || subLang === "off" ? null : subLang,
  );
  const durationRef = useRef(durationSeconds);
  durationRef.current = clockDuration;
  const gone = useRef(false);
  const stall = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leave = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cacheCtx = {
    via: progress.via,
    mediaId: progress.mediaId,
    chapterId: String(progress.chapterId),
  };
  const withCache = (url: string | null) =>
    url ? withCacheParams(url, cacheCtx) : null;
  const saveSettings = (patch: Record<string, string | number>) =>
    void fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }).catch(() => {});

  const writeProgress = useCallback(
    (seconds: number) => {
      if (seconds <= 1) return;
      const duration = durationRef.current;
      const season = progress.season;
      const delta = Math.min(30, Math.floor(pendingWatch.current));
      pendingWatch.current = Math.max(0, pendingWatch.current - delta);
      pushProgress({
        ...progress,
        ...(delta > 0 ? { watchedDelta: delta } : {}),
        anchor: {
          kind: "seconds",
          at: seconds,
          chapterId: String(progress.chapterId),
          chapterName: progress.chapterName,
          ...(duration && duration > 1 ? { duration } : {}),
          ...(season != null && season > 0 ? { season } : {}),
          ...(progress.episode != null && progress.episode > 0 ? { episode: progress.episode } : {}),
        },
      });
    },
    [progress],
  );

  useEffect(() => {
    if ((progress.partIndex ?? 0) < 1 || !usesSeriesTree({ ...progress, skipAhead: true })) return;
    void pushProgress({ ...progress, skipAhead: true });
  }, [progress.mediaId, progress.partIndex]);

  useEffect(() => {
    gone.current = false;
    if (leave.current) {
      clearTimeout(leave.current);
      leave.current = null;
    }
    return () => {
      gone.current = true;
      if (stall.current) clearTimeout(stall.current);
      /*
       * The App Router enables React Strict Mode in development. Its deliberate
       * setup → cleanup → setup cycle is not a real navigation, so tearing down
       * here synchronously killed the brand-new remux/torrent and permanently
       * left `gone` true. Defer teardown one task: the second setup cancels it,
       * while a real unmount still releases peers immediately afterwards.
       */
      leave.current = setTimeout(() => {
        if (!gone.current) return;
        writeProgress(Math.floor(resume.current));
        void fetch("/api/stream", { method: "DELETE", keepalive: true });
      }, 0);
    };
  }, [writeProgress]);

  const href = (base: string | null | undefined) => {
    if (!base) return null;
    const u = new URL(base, "http://lacrima.local");
    u.searchParams.set("lang", lang);
    return `${u.pathname}${u.search}`;
  };

  useEffect(() => {
    let live = true;
    setErr(null);
    setGroups([]);
    setGid(null);
    setHttpAt(0);
    setTorrentBatch(0);
    setRaceTry(0);
    setSourceProvider(null);
    setRevealKey(null);
    setFromCache(false);
    setLangNoteOff(false);
    seeded.current = null;
    committed.current = null;
    const u = new URL(href(playUrl)!, "http://lacrima.local");
    if (bustCache) u.searchParams.set("fresh", "1");
    fetch(`${u.pathname}${u.search}`)
      .then(async (r) => {
        const j = (await r.json()) as {
          groups?: StreamGroup[];
          preferred?: string | null;
          error?: string;
          source?: { provider: string; cached?: boolean };
        };
        if (!live) return;
        const next = j.groups ?? [];
        if (!r.ok || !next.length) setErr(j.error ?? "No stream for this episode.");
        else {
          setGroups(next);
          const want =
            next.find((g) => g.id === j.preferred)?.id ??
            next.find((g) => g.lang === lang)?.id ??
            next[0].id;
          setGid(want);
          if (j.source?.provider) {
            setSourceProvider(j.source.provider);
            if (j.source.cached) {
              setFromCache(true);
              setRevealKey(`cache:${j.source.provider}`);
            }
          }
        }
      })
      .catch(() => {
        if (live) setErr("Could not reach the stream resolver.");
      });
    return () => {
      live = false;
    };
  }, [playUrl, bustCache, lang, retryAt]);

  useEffect(() => {
    let live = true;
    setCues([]);
    setSubErr(null);
    setSubLoading(true);
    const q = new URLSearchParams({
      chapterId: String(progress.chapterId),
      via: progress.via,
      mediaId: String(progress.mediaId),
    });
    if (subFresh) q.set("fresh", "1");
    fetch(`/api/subs?${q}`)
      .then(async (r) => {
        const j = (await r.json()) as { cues?: SubCue[]; error?: string };
        if (!live) return;
        if (!r.ok) setSubErr(j.error ?? "Could not load subtitles.");
        else setCues(j.cues ?? []);
      })
      .catch(() => {
        if (live) setSubErr("Could not load subtitles.");
      })
      .finally(() => {
        if (live) setSubLoading(false);
      });
    return () => {
      live = false;
    };
  }, [progress.chapterId, progress.via, progress.mediaId, subFresh]);

  useEffect(() => {
    const episode = progress.episode;
    if (!episode) {
      setSkipSegments([]);
      return;
    }
    const controller = new AbortController();
    const query = new URLSearchParams({
      via: progress.via,
      mediaId: String(progress.mediaId),
      episode: String(episode),
    });
    fetch(`/api/skip-times?${query}`, { signal: controller.signal })
      .then((r) => r.ok ? r.json() : { segments: [] })
      .then((data: { segments?: SkipSegment[] }) => {
        if (!controller.signal.aborted) setSkipSegments(data.segments ?? []);
      })
      .catch(() => {
        if (!controller.signal.aborted) setSkipSegments([]);
      });
    return () => controller.abort();
  }, [progress.episode, progress.mediaId, progress.via]);

  const group = groups.find((g) => g.id === gid) ?? groups[0];
  const wantedSub: Lang | undefined =
    settings.subtitle_lang !== "off" && group?.lang !== "en" ? "en" : undefined;
  const matchingPicks = wantedSub
    ? group?.picks.filter((p) => p.subtitles?.includes(wantedSub)) ?? []
    : [];
  const groupPicks = matchingPicks.length ? matchingPicks : group?.picks ?? [];
  const { http: httpPicks, torrent: torrentPicks } = splitPicks(groupPicks);
  const pick =
    httpPicks[httpAt] ?? torrentPicks[torrentBatch * TORRENT_RACE_MAX];
  const solePick =
    fromCache && groupPicks.length === 1 ? groupPicks[0].url : null;
  const raceBatchLen = Math.min(
    TORRENT_RACE_MAX,
    Math.max(0, torrentPicks.length - torrentBatch * TORRENT_RACE_MAX),
  );
  /*
   * Every source is remuxed, so the audio track is the one that was asked for.
   *
   * A browser cannot choose between the `hin`, `eng` and `jpn` tracks a single
   * file carries — Chrome exposes no `audioTracks` — so without this the viewer
   * gets whichever came first, which is how asking for Japanese played Hindi.
   * The same pass rewraps containers and re-encodes audio no browser decodes.
   *
   * `startAt` is part of the URL because a remux is a live pipe: it cannot answer
   * a byte range, so resuming is a request that begins at that keyframe rather
   * than a seek performed after loading.
   */
  const src = remuxUrl(
    withRaceTry(
      withCache(
        solePick ??
          mixedRaceUrl(httpPicks, torrentPicks, httpAt, torrentBatch) ??
          httpPicks[httpAt]?.url ??
          torrentRaceUrl(torrentPicks, torrentBatch),
      ),
      raceTry,
    ),
    lang,
    startAt,
    wantedSub,
  );
  const useMse = hydrated && Boolean(src?.includes("remux=1") && mseSupported());
  const mse = useMseSrc(useMse ? src : null);
  /* A remux HTTP error is final for this pick. Do not hand the exact same 502
     URL to the native provider before selecting the next source. */
  const playSrc = !hydrated ? null : mse.httpError != null ? null : useMse && !mse.failed ? mse.url : src;

  useEffect(() => {
    committed.current = null;
    playedFor.current = 0;
    native.current = false;
  }, [src]);

  /* A torrent with no peers, or a pack with no matching file, is one candidate
     failing — not the episode failing. Stay on this language; drop quality last. */
  const failOver = useCallback((reason?: "source-error") => {
    if (gone.current || !group) return;
    /* A truthful 502 from the remux means the direct file itself was unusable
       (most often it lacks the requested audio). Try the next direct file before
       spending a minute walking the still-warming torrent pool. */
    if (
      reason === "source-error" &&
      src &&
      isMixedRaceUrl(src) &&
      httpAt + 1 < httpPicks.length
    ) {
      seeded.current = null;
      setSourceProvider(null);
      setRevealKey(null);
      setFromCache(false);
      setRaceTry(0);
      setHttpAt(httpAt + 1);
      return;
    }
    const racing =
      src &&
      (isMixedRaceUrl(src) || isTorrentRaceUrl(src)) &&
      raceBatchLen > 1 &&
      raceTry + 1 < raceBatchLen;
    if (racing) {
      seeded.current = null;
      setRaceTry(raceTry + 1);
      return;
    }
    setSourceProvider(null);
    setRevealKey(null);
    setFromCache(false);
    if (httpAt + 1 < httpPicks.length) {
      seeded.current = null;
      setRaceTry(0);
      setHttpAt(httpAt + 1);
      return;
    }
    const nextBatch = (torrentBatch + 1) * TORRENT_RACE_MAX;
    if (nextBatch < torrentPicks.length) {
      seeded.current = null;
      setRaceTry(0);
      setTorrentBatch(torrentBatch + 1);
      return;
    }
    const same = groups.filter((g) => g.lang === group.lang);
    const idx = same.findIndex((g) => g.id === group.id);
    const next = same[idx + 1];
    if (next) {
      seeded.current = null;
      setGid(next.id);
      setHttpAt(0);
      setTorrentBatch(0);
      setRaceTry(0);
      return;
    }
    /* Everything stored for this language is exhausted. A stored playlist can be
       months old and HTTP links rot, so re-resolve once from the addons before
       telling the user it cannot be played. */
    if (!bustCache) {
      seeded.current = null;
      setRaceTry(0);
      setHttpAt(0);
      setTorrentBatch(0);
      setBustCache(true);
      return;
    }
    setErr(
      `Nothing in ${group.label} would start. Pick another quality or language, or try again later.`,
    );
  }, [
    httpAt,
    torrentBatch,
    raceTry,
    raceBatchLen,
    src,
    group,
    groups,
    httpPicks,
    torrentPicks,
    bustCache,
  ]);

  const failOverRef = useRef(failOver);
  failOverRef.current = failOver;

  useEffect(() => {
    if (useMse && mse.httpError != null) failOverRef.current("source-error");
  }, [src, useMse, mse.httpError]);

  /* A torrent can answer with headers and then never send a byte, which the player
     reports as nothing at all. Without this the page just spins forever. */
  useEffect(() => {
    if (!pick?.hint || browserPlayable(pick.hint)) return;
    failOverRef.current();
  }, [pick?.hint, pick?.url]);

  /* Deadline is wall-clock against this src, so a re-render cannot reset it.
     Background tabs freeze setTimeout; the interval catches up when you return. */
  useEffect(() => {
    if (!src) return;
    const ms = srcDeadlineMs(src);
    const started = Date.now();
    let fired = false;
    let reloaded = false;
    const tick = () => {
      if (gone.current || fired) return;
      if (player.current?.state.canPlay) return;
      /* Pause must not look like a dead source. A live remux drops readyState
         when the element stops reading; load() then restarts at the URL's `t=`,
         which is where the remux first began, not where the viewer paused. */
      if (player.current?.state.paused && playedFor.current > 0) return;
      const media = document.querySelector<HTMLVideoElement>(".player-root video");
      const elapsed = Date.now() - started;
      /*
       * NETWORK_NO_SOURCE with a perfectly good URL attached.
       *
       * Vidstack provides the URL as a <source> child rather than the element's
       * own src, and swapping a <source>'s URL does not restart the browser's
       * resource selection — the element stays parked on the verdict it reached
       * before the URL existed. Nothing signals this: a <source> error does not
       * bubble, so `onError` never runs and `media.error` stays null, and the
       * player waited out the full deadline on every candidate in turn. That is
       * why every episode looked like it was endlessly "racing sources" while the
       * relay was answering each of those URLs with 206 in a few hundred ms.
       *
       * `load()` re-runs selection, which is all that was ever needed. Failing
       * over here instead would have thrown away sources that work.
       */
      const noSource = media?.networkState === 3 && media.readyState === 0;
      /* load() tears down a MediaSource. The remux is already being fetched. */
      if (noSource && elapsed > 1_000 && !(useMse && !mse.failed)) {
        if (!reloaded && media.querySelector("source")?.getAttribute("src")) {
          reloaded = true;
          media.load();
          return;
        }
        /* Deliberately no early failover here. The candidates reaching this state
           are not dead: the relay answers them 206 and then kills the body on an
           open-ended Range, which is the only kind a media element sends. Skipping
           them faster would only reach the end of the list sooner. */
      }
      if (elapsed < ms) return;
      fired = true;
      failOverRef.current();
    };
    const id = setInterval(tick, 500);
    tick();
    return () => clearInterval(id);
  }, [src, useMse, mse.failed]);

  const clearStall = useCallback(() => {
    if (stall.current) {
      clearTimeout(stall.current);
      stall.current = null;
    }
  }, []);

  const seekTo = useCallback(
    (seconds: number) => {
      const cap = clockDuration ?? seconds;
      const next = Math.max(0, Math.min(cap, seconds));
      clearStall();
      resume.current = next;
      setPosition(next);
      const media = document.querySelector<HTMLVideoElement>(".player-root video");
      const plan = planSeek({
        next,
        startAt,
        native: native.current,
        ranges: media?.buffered ?? null,
      });
      if (plan.kind === "currentTime") {
        if (media) media.currentTime = plan.time;
        return;
      }
      seeded.current = null;
      setStartAt(plan.startAt);
    },
    [clearStall, clockDuration, startAt],
  );

  const seekBy = useCallback(
    (seconds: number) => {
      const elapsed =
        document.querySelector<HTMLVideoElement>(".player-root video")?.currentTime ?? 0;
      seekTo((native.current ? 0 : startAt) + elapsed + seconds);
    },
    [seekTo, startAt],
  );

  const startAtRef = useRef(startAt);
  startAtRef.current = startAt;
  const seekToRef = useRef(seekTo);
  seekToRef.current = seekTo;

  const mediaTime = () =>
    document.querySelector<HTMLVideoElement>(".player-root video")?.currentTime ?? 0;

  const onPauseHold = () => {
    const elapsed = mediaTime();
    if (elapsed < 0.5) return;
    const at = startAtRef.current + elapsed;
    pausedAt.current = at;
    resume.current = at;
  };

  const onResumeHold = () => {
    if (native.current) {
      pausedAt.current = null;
      return;
    }
    const want = pausedAt.current;
    if (want == null) return;
    /* A remux can reopen at its original URL when playback resumes. That URL is
       `t=0` on a first watch, so check after the browser has had a frame to
       reset its clock and restore the pause point only when it actually did. */
    requestAnimationFrame(() => {
      const elapsed = mediaTime();
      if (elapsed > 1) {
        pausedAt.current = null;
        return;
      }
      pausedAt.current = null;
      seekToRef.current(want);
    });
  };

  /* Progress is a side effect of watching, never a step in it: this reads position
     off the player without rendering, and a lost write costs a position, not a page. */
  /* Only persist picks and finalize chunk files after ~15s of real playback. */
  useEffect(() => {
    const p = player.current;
    if (!p || !src || !group || !pick) return;
    const id = setInterval(() => {
      const currentTime =
        document.querySelector<HTMLVideoElement>(".player-root video")?.currentTime ?? 0;
      if (currentTime < 15 || committed.current === src) return;
      committed.current = src;
      const store = new URL(src, "http://lacrima.local");
      store.searchParams.delete("cv");
      store.searchParams.delete("cm");
      store.searchParams.delete("cc");
      void fetch("/api/play/cache", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          via: progress.via,
          mediaId: progress.mediaId,
          chapterId: String(progress.chapterId),
          groupId: group.id,
          pick: {
            url: `${store.pathname}${store.search}`,
            provider: pick.provider,
            hint: pick.hint,
          },
        }),
        keepalive: true,
      }).catch(() => {});
    }, 1_000);
    return () => clearInterval(id);
  }, [src, group, pick, progress]);

  useEffect(() => {
    const p = player.current;
    if (!p) return;
    let last = -1;
    let lastWrite = 0;
    lastWall.current = Date.now();
    /* A remuxed stream begins at `startAt`, so its clock starts at zero however
       far into the episode it actually is. Everything outside the player — the
       saved anchor, the next resume, the progress row — wants the real position. */
    const tick = setInterval(() => {
      const media = document.querySelector<HTMLVideoElement>(".player-root video");
      const currentTime = media?.currentTime ?? 0;
      const wall = Date.now();
      const dt = (wall - lastWall.current) / 1000;
      lastWall.current = wall;
      if (!media?.paused && currentTime > 0.2 && dt > 0 && dt < 2) {
        pendingWatch.current += dt;
      }
      if (currentTime > 1) {
        const absolute = native.current ? currentTime : startAt + currentTime;
        playedFor.current = Math.max(playedFor.current, currentTime);
        resume.current = absolute;
        setPosition((old) => Math.floor(old) === Math.floor(absolute) ? old : absolute);
        const duration = durationRef.current;
        if (duration && duration > 1) {
          const end = bufferedEnd(media?.buffered ?? null);
          const { buffered } = scrubPercents({
            position: absolute,
            duration,
            startAt,
            native: native.current,
            bufferedEnd: end,
          });
          setBufferedPct((old) => (Math.abs(old - buffered) < 0.005 ? old : buffered));
        }
      }
      const now = Math.floor(resume.current);
      if (now > 1 && now !== last && Date.now() - lastWrite >= 5_000) {
        last = now;
        lastWrite = Date.now();
        writeProgress(now);
      }
    }, 500);
    return () => clearInterval(tick);
  }, [writeProgress, src, startAt]);

  /* Vidstack owns the media keys (space, j/k/l, arrows, m, f) and correctly ignores
     them while a field has focus. Only the two that navigate the app live here. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowLeft" || e.key.toLowerCase() === "j") {
        e.preventDefault();
        e.stopImmediatePropagation();
        seekBy(-10);
      } else if (e.key === "ArrowRight" || e.key.toLowerCase() === "l") {
        e.preventDefault();
        e.stopImmediatePropagation();
        seekBy(10);
      } else if (e.key === "Escape" && !document.fullscreenElement) router.push(backHref);
      else if (e.key === "n" && nextHref) router.push(nextHref);
      else if (e.key.toLowerCase() === "c") {
        e.preventDefault();
        setSubLang((cur) => {
          const next = toggleSubChoice(cur, lastSub.current);
          localStorage.setItem("lacrima-subs", next);
          saveSettings({ subtitle_lang: next === "off" ? "off" : "auto" });
          return next;
        });
      } else {
        const jump = jumpPercent(clockDuration, e.key);
        if (jump != null) {
          e.preventDefault();
          seekTo(jump);
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [backHref, clockDuration, nextHref, router, seekBy, seekTo]);

  /* Only once a group is actually chosen, so this cannot flash while resolving. */
  const wrongLang = group && group.lang !== lang ? group : null;
  const audioLang = group?.lang ?? lang;
  const activeCue = cueByChoice(cues, subLang);

  useEffect(() => {
    if (subLoading) return;
    setSubLang(pickSubLang(cues, audioLang, settings.subtitle_lang));
  }, [cues, subLoading, audioLang, settings.subtitle_lang]);

  /* Softsubs inside the torrent become readable as early clusters land — keep
     polling and refresh the growing extract until the file is complete. */
  useEffect(() => {
    if (subLoading || !wantedSub) return;
    let live = true;
    let busy = false;
    let attempts = 0;
    const q = new URLSearchParams({
      chapterId: String(progress.chapterId),
      via: progress.via,
      mediaId: String(progress.mediaId),
      local: "1",
    });
    const torrent = pick?.url ? new URL(pick.url, "http://lacrima.local") : null;
    const ih = torrent?.searchParams.get("ih");
    if (ih) {
      q.set("ih", ih);
      const i = torrent!.searchParams.get("i");
      if (i != null && i !== "") q.set("i", i);
      const s = torrent!.searchParams.get("s");
      const e = torrent!.searchParams.get("e");
      if (s) q.set("s", s);
      if (e) q.set("e", e);
    }
    const find = async () => {
      if (!live || busy || attempts++ >= 360) return;
      busy = true;
      try {
        const r = await fetch(`/api/subs?${q}`);
        const j = (await r.json()) as { cues?: SubCue[]; pending?: boolean };
        if (!live || !r.ok) return;
        if (j.cues?.length) {
          setCues((old) => {
            const byId = new Map(old.map((c) => [c.id, c]));
            for (const c of j.cues!) byId.set(c.id, c);
            const next = [...byId.values()].sort(
              (a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id),
            );
            return next.length === old.length && next.every((c, i) => c.url === old[i]?.url)
              ? old
              : next;
          });
        }
        if (j.cues?.some((cue) => cue.lang === wantedSub) && !j.pending) clearInterval(timer);
      } catch {
        /* the normal external-subtitle result remains usable */
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(find, 5_000);
    void find();
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [subLoading, wantedSub, progress.chapterId, progress.via, progress.mediaId, pick?.url]);

  const [timed, setTimed] = useState<TimedCue[]>([]);
  const [subAt, setSubAt] = useState(initialTime);
  const syncKey = subSyncKey(progress.via, progress.mediaId, String(progress.chapterId));
  const [subSync, setSubSync] = useState(() =>
    typeof window === "undefined" ? 0 : parseSubSync(localStorage.getItem(syncKey)),
  );

  useEffect(() => {
    setSubSync(parseSubSync(localStorage.getItem(syncKey)));
  }, [syncKey]);

  useEffect(() => {
    if (!activeCue) {
      setTimed([]);
      return;
    }
    let live = true;
    fetch(fileHref(activeCue.url, {
      via: progress.via,
      mediaId: progress.mediaId,
      chapterId: String(progress.chapterId),
    }))
      .then((r) => r.text())
      .then((t) => {
        if (live) setTimed(parseCues(t));
      })
      .catch(() => {
        if (live) setTimed([]);
      });
    return () => {
      live = false;
    };
  }, [activeCue?.url]);

  /* Accurate remux seeks make currentTime relative to `startAt`. */
  useEffect(() => {
    const id = setInterval(() => {
      const currentTime =
        document.querySelector<HTMLVideoElement>(".player-root video")?.currentTime ?? 0;
      const absolute = remuxEpisodeTime(startAt, currentTime, native.current) - subSync;
      setSubAt((old) => (Math.abs(old - absolute) < 0.04 ? old : absolute));
    }, 80);
    return () => clearInterval(id);
  }, [src, startAt, subSync]);

  useEffect(() => {
    if (subLang !== "off") lastSub.current = subLang;
  }, [subLang]);

  const countdown = nextUpCountdown({
    position,
    duration: clockDuration,
    ended,
    outro: skipSegments.find((segment) => segment.type === "ed" || segment.type === "mixed-ed") ?? null,
    watchedSeconds: playedFor.current,
    cancelled: nextCancelled,
    hasNext: Boolean(nextHref),
  });
  const activeSkip = skipSegments.find((segment) => position >= segment.start && position < segment.end);

  const finding = err
    ? null
    : !src
      ? "Finding a stream"
      : fromCache
        ? null
        : src && isMixedRaceUrl(src)
          ? "Racing sources"
          : torrentBatch > 0 || httpAt > 0 || raceTry > 0
          ? group?.label ?? "Next source"
          : src && isTorrentRaceUrl(src)
            ? "Racing torrents"
            : src?.includes("ih=")
              ? "Connecting to peers"
              : null;

  return (
    <MediaPlayer
      key={src ?? "empty"}
      ref={player}
      className="reader player-root"
      src={playSrc ? sourceFor(playSrc) : undefined}
      title={title}
      autoPlay
      playsInline
      streamType="on-demand"
      load="eager"
      keyTarget="document"
      onProviderChange={onProviderChange}
      onError={() => {
        if (!playSrc) return;
        clearStall();
        failOverRef.current("source-error");
      }}
      onWaiting={() => {
        if (!src || !player.current?.state.canPlay || player.current.state.paused) return;
        clearStall();
        stall.current = setTimeout(() => {
          if (player.current?.state.waiting) failOverRef.current();
        }, src.includes("ih=") ? 20_000 : 12_000);
      }}
      onPlaying={clearStall}
      onPause={onPauseHold}
      onPlay={onResumeHold}
      onCanPlay={() => {
        const media = document.querySelector<HTMLVideoElement>(".player-root video");
        const duration = media?.duration ?? 0;
        const end = media?.seekable.length ? media.seekable.end(media.seekable.length - 1) : 0;
        if (
          media &&
          !useMse &&
          Number.isFinite(duration) &&
          duration > 1 &&
          end > 1
        ) {
          native.current = true;
          setClockDuration(duration);
          const want = resume.current;
          if (want > 1 && Math.abs(media.currentTime - want) > 0.4) media.currentTime = want;
          if (startAtRef.current !== 0) setStartAt(0);
        }
        /* Resume once per candidate: canPlay fires again after a seek, and failing
           over should land where you were watching, not back at the start. */
        if (seeded.current === src) return;
        seeded.current = src;
        const provider = pick?.provider ?? sourceProvider;
        if (provider) {
          setSourceProvider(provider);
          setRevealKey((prev) =>
            prev === `cache:${provider}` ? prev : `${src}:${provider}`,
          );
        }
        const track = pickAudioTrack(
          listedTracks(player.current),
          group?.lang ?? lang,
          pick?.hint,
        );
        if (track === -1) {
          failOver();
          return;
        }
        if (track != null) player.current?.remoteControl.changeAudioTrack(track);
        /* No seek: the remux already began at `startAt`, and asking a live pipe
           to seek to a position it is already at only stalls it. */
        /* Only once this episode is safely playing, so warming the next one can
           never compete with the request the user is actually waiting on. */
        if (warmUrl && !warmed.current) {
          warmed.current = true;
          void fetch(href(warmUrl)!).catch(() => {});
        }
      }}
      onEnded={() => {
        /* A failed live remux ends its media element too. Never turn a zero-byte
           ffmpeg exit into "episode finished" and silently jump to the next one. */
        setEnded(true);
      }}
    >
      <MediaProvider />
      <PlayerGestures />
      {activeCue && <SubOverlay cues={timed} at={subAt} scale={captionScale} />}

      {err ? (
        <div className="player-stage">
          <div className="empty" style={{ maxWidth: 460 }}>
            <b>Can&apos;t play this</b>
            {err} Try another quality or language, another episode, or a different source on the title page.
            <div className="acts" style={{ marginTop: 14 }}>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  setErr(null);
                  setHttpAt(0);
                  setTorrentBatch(0);
                  setRaceTry(0);
                  setBustCache(true);
                  setRetryAt((n) => n + 1);
                }}
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      ) : (
        <Wait finding={finding} />
      )}

      {/* Falling back to another language is a real answer, but it has to be said.
          This used to be silent: you asked for Japanese and got Spanish. */}
      {!err && wrongLang && !langNoteOff && (
        <div className="player-note" role="status">
          <span className="dot" style={{ background: "var(--warn)" }} />
          <span>
            No {langLabel(lang)} for this episode — playing {wrongLang.label}.
          </span>
          <button type="button" onClick={() => setLangNoteOff(true)}>
            Dismiss
          </button>
        </div>
      )}

      {countdown != null && nextHref && (
        <div className="player-nextup">
          <div className="player-nextup-card">
            <span className="mono">Up next{countdown > 0 ? ` · ${countdown}` : ""}</span>
            <b>{nextLabel ?? "Next episode"}</b>
            <div className="acts">
              <a className="btn primary" href={nextHref}>
                Play now
              </a>
              <button type="button" className="btn" onClick={() => setNextCancelled(true)}>
                Watch credits
              </button>
            </div>
          </div>
        </div>
      )}

      {activeSkip && (
        <div className="player-skip">
          <button type="button" className="btn primary" onClick={() => seekTo(activeSkip.end)}>
            Skip {skipLabel(activeSkip.type)}
          </button>
        </div>
      )}

      <Controls.Root className="player-controls" hideDelay={2800}>
        <Controls.Group className="reader-bar player-top">
          <a className="pbtn" href={backHref} aria-label="Back to title">
            <Icon d={PATH.arrow} filled={false} />
          </a>
          <PlayerMeta
            title={title}
            episodeLabel={episodeLabel}
            provider={sourceProvider}
            revealKey={revealKey}
          />
        </Controls.Group>

        <Controls.Group className="reader-bar bottom player-dock">
          <div className="player-scrub-row">
            <RemuxTimeline
              position={position}
              duration={clockDuration}
              buffered={bufferedPct}
              segments={skipSegments}
              onSeek={seekTo}
            />
          </div>

          <div className="player-row">
            <div className="player-side">
              <PlayButton className="pbtn">
                <PlayPause />
              </PlayButton>
              <IconBtn onClick={() => seekBy(-10)} aria-label="Back 10 seconds">
                <Icon d={PATH.back10} />
              </IconBtn>
              <IconBtn onClick={() => seekBy(10)} aria-label="Forward 10 seconds">
                <Icon d={PATH.fwd10} />
              </IconBtn>
              <div className="player-audio">
                <MuteButton className="pbtn">
                  <Volume />
                </MuteButton>
                <VolumeSlider.Root className="player-vol" aria-label="Volume">
                  <VolumeSlider.Track className="scrub-track">
                    <VolumeSlider.TrackFill className="scrub-fill" />
                  </VolumeSlider.Track>
                  <VolumeSlider.Thumb className="scrub-thumb" />
                </VolumeSlider.Root>
              </div>
            </div>

            <div className="player-side player-side-end">
              {groups.length > 0 && (
                <DockMenu
                  value={gid ?? groups[0].id}
                  groups={groups}
                  onPick={(id) => {
                    const g = groups.find((x) => x.id === id);
                    setErr(null);
                    setGid(id);
                    setHttpAt(0);
                    setTorrentBatch(0);
                    setSourceProvider(null);
                    setRevealKey(null);
                    seeded.current = null;
                    committed.current = null;
                  if (g) {
                      setLang(g.lang);
                      localStorage.setItem("lacrima-lang", g.lang);
                      saveSettings({ audio_lang: g.lang });
                    }
                  }}
                  subLang={subLang}
                  cues={cues}
                  subLoading={subLoading}
                  subError={subErr}
                  onPickSub={(choice) => {
                    setSubLang(choice);
                    localStorage.setItem("lacrima-subs", choice);
                    saveSettings({ subtitle_lang: choice === "off" ? "off" : "auto" });
                  }}
                  subSync={subSync}
                  onSubSync={(n) => {
                    const next = parseSubSync(String(n));
                    setSubSync(next);
                    localStorage.setItem(syncKey, String(next));
                  }}
                  captionScale={captionScale}
                  onCaptionScale={(n) => {
                    setCaptionScale(n);
                    localStorage.setItem("lacrima-caption-scale", String(n));
                    saveSettings({ caption_scale: n });
                  }}
                  onRefreshSubs={() => setSubFresh((n) => n + 1)}
                />
              )}
              {episodes.length > 1 && (
                <EpisodeDock episodes={episodes} currentId={currentId} progress={progress} />
              )}
              {nextHref && (
                <a className="pbtn" href={nextHref} aria-label="Next episode">
                  <Icon d={PATH.next} />
                </a>
              )}
              <PlayerFullscreen player={player} />
            </div>
          </div>
        </Controls.Group>
      </Controls.Root>
    </MediaPlayer>
  );
}

function PlayPause() {
  const paused = useMediaState("paused");
  return <Icon d={paused ? PATH.play : PATH.pause} />;
}

/* Desktop click pauses like YouTube. Touch still taps to reveal the dock —
   mouse move is how chrome comes back on a fine pointer. */
function PlayerGestures() {
  const pointer = useMediaState("pointer");
  const touch = pointer === "coarse";
  return (
    <>
      <Gesture
        className="player-gesture"
        event="pointerup"
        action="toggle:paused"
        disabled={touch}
      />
      <Gesture
        className="player-gesture"
        event="pointerup"
        action="toggle:controls"
        disabled={!touch}
      />
    </>
  );
}

function DockMenu({
  value,
  groups,
  onPick,
  subLang,
  cues,
  subLoading,
  subError,
  onPickSub,
  subSync,
  onSubSync,
  captionScale,
  onCaptionScale,
  onRefreshSubs,
}: {
  value: string;
  groups: StreamGroup[];
  onPick: (id: string) => void;
  subLang: SubChoice;
  cues: SubCue[];
  subLoading: boolean;
  subError: string | null;
  onPickSub: (choice: SubChoice) => void;
  subSync: number;
  onSubSync: (n: number) => void;
  captionScale: number;
  onCaptionScale: (n: number) => void;
  onRefreshSubs: () => void;
}) {
  const selected = groups.find((g) => g.id === value) ?? groups[0];
  const qualities = qualitiesForLang(groups, selected.lang);
  const langs = langChoices(groups);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"quality" | "language" | "subs">(
    qualities.length > 1 ? "quality" : langs.length > 1 ? "language" : "subs",
  );
  const ariaLabel = `Quality and language, ${selected.label}`;
  const compactLabel = `${selected.quality} · ${selected.lang.toUpperCase()}`;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);
  return (
    <div
      className="player-lang"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <IconBtn
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
      >
        {compactLabel}
      </IconBtn>
      {open && (
        <div className="player-lang-menu">
          <div className="player-lang-tabs" role="tablist" aria-label="Quality, language and subtitles">
            {qualities.length > 1 && (
              <button
                type="button"
                role="tab"
                aria-selected={tab === "quality"}
                className={tab === "quality" ? "on" : undefined}
                onClick={() => setTab("quality")}
              >
                Quality
              </button>
            )}
            {langs.length > 1 && (
              <button
                type="button"
                role="tab"
                aria-selected={tab === "language"}
                className={tab === "language" ? "on" : undefined}
                onClick={() => setTab("language")}
              >
                Language
              </button>
            )}
            <button
              type="button"
              role="tab"
              aria-selected={tab === "subs"}
              className={tab === "subs" ? "on" : undefined}
              onClick={() => setTab("subs")}
            >
              Subs
            </button>
          </div>
          {tab === "quality" ? (
            <ul role="listbox" aria-label="Quality">
              {qualities.map((item) => (
                <li key={item.id} role="option" aria-selected={item.id === value}>
                  <button
                    className={item.id === value ? "on" : undefined}
                    type="button"
                    onClick={() => {
                      onPick(item.id);
                      setOpen(false);
                    }}
                  >
                    {item.quality}
                  </button>
                </li>
              ))}
            </ul>
          ) : tab === "language" ? (
            <ul role="listbox" aria-label="Language">
              {langs.map((item) => (
                <li key={item.lang} role="option" aria-selected={item.lang === selected.lang}>
                  <button
                    className={item.lang === selected.lang ? "on" : undefined}
                    type="button"
                    onClick={() => {
                      onPick(item.id);
                      setOpen(false);
                    }}
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <>
              <ul role="listbox" aria-label="Subtitles">
              {subLoading ? (
                <li className="player-lang-note">Finding subtitles</li>
              ) : subError ? (
                <li className="player-lang-note">
                  {subError}{" "}
                  <button type="button" onClick={onRefreshSubs}>
                    Find again
                  </button>
                </li>
              ) : (
                <>
                  <li role="option" aria-selected={subLang === "off"}>
                    <button
                      className={subLang === "off" ? "on" : undefined}
                      type="button"
                      onClick={() => {
                        onPickSub("off");
                        setOpen(false);
                      }}
                    >
                      Off
                    </button>
                  </li>
                  {cues.map((c) => (
                    <li key={c.id} role="option" aria-selected={c.id === subLang}>
                      <button
                        className={c.id === subLang ? "on" : undefined}
                        type="button"
                        onClick={() => {
                          onPickSub(c.id);
                          setOpen(false);
                        }}
                      >
                        {c.label}
                      </button>
                    </li>
                  ))}
                  {!cues.length && (
                    <li className="player-lang-note">
                      None for this episode{" "}
                      <button type="button" onClick={onRefreshSubs}>
                        Find again
                      </button>
                    </li>
                  )}
                </>
              )}
            </ul>
            <div
              className="player-sub-sync"
              data-zero={subSync === 0 ? "" : undefined}
              style={{ "--sync": subSync } as CSSProperties}
            >
              <div className="player-sub-sync-row">
                <span>Sync</span>
                <output>{`${subSync > 0 ? "+" : ""}${Number(subSync.toFixed(2))}s`}</output>
              </div>
              <div className="player-sub-sync-scrub">
                <span className="player-sub-sync-track" />
                <span className="player-sub-sync-fill" />
                <span className="player-sub-sync-thumb" />
                <input
                  className="player-sub-sync-range"
                  type="range"
                  min={-SUB_SYNC_RANGE}
                  max={SUB_SYNC_RANGE}
                  step={SUB_SYNC_STEP}
                  value={subSync}
                  aria-label="Subtitle delay"
                  onChange={(e) => onSubSync(Number(e.currentTarget.value))}
                />
              </div>
            </div>
            <div className="player-sub-sync">
              <div className="player-sub-sync-row">
                <span>Size</span>
                <output>{captionScaleLabel(captionScale)}</output>
              </div>
              <div className="player-lang-tabs" role="radiogroup" aria-label="Caption size">
                {CAPTION_SCALES.map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={captionScale === n}
                    className={captionScale === n ? "on" : undefined}
                    onClick={() => onCaptionScale(n)}
                  >
                    {captionScaleLabel(n)}
                  </button>
                ))}
              </div>
            </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function EpisodeDock({
  episodes,
  currentId,
  progress,
}: {
  episodes: DockEpisode[];
  currentId?: string;
  progress: ProgressWrite;
}) {
  const [open, setOpen] = useState(false);
  const seasons = dockSeasons(episodes);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    document.querySelector<HTMLElement>(".player-ep-menu a.on")?.scrollIntoView({ block: "nearest" });
  }, [open, currentId]);
  return (
    <div
      className="player-lang"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <IconBtn
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Episodes"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon d={PATH.list} filled={false} />
      </IconBtn>
      {open && (
        <div className="player-lang-menu player-ep-menu">
          {seasons.map((s) => (
            <div key={s.season}>
              {seasons.length > 1 ? <div className="player-ep-season">{s.label}</div> : null}
              <ul role="listbox" aria-label={s.label}>
                {s.items.map((ep) => (
                  <li key={ep.id} role="option" aria-selected={ep.id === currentId}>
                    <a
                      className={ep.id === currentId ? "on" : undefined}
                      href={ep.href}
                      onClick={(e) => {
                        e.preventDefault();
                        const i = episodes.findIndex((x) => x.id === ep.id);
                        void pushProgress({
                          ...progress,
                          unit: i + 1,
                          chapterId: ep.id,
                          chapterName: ep.name,
                          season: ep.season,
                          episode: ep.number,
                          skipAhead: true,
                        }).then(() => {
                          window.location.href = ep.href;
                        });
                      }}
                    >
                      <span className="mono">E{ep.number}</span>
                      {ep.name}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Volume() {
  const muted = useMediaState("muted");
  const volume = useMediaState("volume");
  return <Icon d={muted || volume === 0 ? PATH.mute : PATH.vol} filled={false} />;
}

function PlayerFullscreen({ player }: { player: { current: MediaPlayerInstance | null } }) {
  const fullscreen = useMediaState("fullscreen");
  return (
    <button
      type="button"
      className="pbtn"
      aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
      onClick={() => {
        const video = document.querySelector<HTMLVideoElement>(".player-root video");
        if (video?.webkitDisplayingFullscreen && video.webkitExitFullscreen) {
          video.webkitExitFullscreen();
          return;
        }
        if (video?.webkitSupportsFullscreen && video.webkitEnterFullscreen) {
          video.webkitEnterFullscreen();
          return;
        }
        if (document.fullscreenElement) {
          void document.exitFullscreen().catch(() => {});
          return;
        }
        void player.current?.enterFullscreen().catch(() => {});
      }}
    >
      <Icon d={PATH.full} filled={false} />
    </button>
  );
}
