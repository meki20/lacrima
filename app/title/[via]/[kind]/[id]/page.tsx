import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import LibraryMenu from "@/components/LibraryMenu";
import MatchList from "@/components/MatchList";
import TitleChapters from "@/components/TitleChapters";
import TopBar from "@/components/TopBar";
import WatchCta from "@/components/WatchCta";
import WeakMatchNote from "@/components/WeakMatchNote";
import { Failed } from "@/components/ui";
import { KIND_INFO } from "@/lib/kinds";
import { searchTitles } from "@/lib/match";
import { weakDismissKey } from "@/lib/weak-note";
import { fetchTitle, parseTitleRoute } from "@/lib/metadata";
import { navTabForKind } from "@/lib/nav";
import { currentProfile } from "@/lib/profile";
import { getLibrary } from "@/lib/library";
import { continueDetail, getProgress, parseAnchor, unitPip } from "@/lib/progress";
import { awardForTitle } from "@/lib/stickers";
import { Err, type Result } from "@/lib/result";
import { pinBinding, resolveSource, type Resolution } from "@/lib/resolve";
import { backend } from "@/lib/sources";
import { IMDB_SOURCE } from "@/lib/sources/stremio";
import { episodeWindow, fetchSeries, progressTree, seriesTitle, type Series } from "@/lib/series";

export const dynamic = "force-dynamic";

function partHref(
  here: string,
  part: number | "specials",
  change: boolean,
  firstId: number,
): string {
  const q = new URLSearchParams();
  if (part === "specials") q.set("part", "specials");
  else if (part !== firstId) q.set("part", String(part));
  if (change) q.set("change", "1");
  const s = q.toString();
  return s ? `${here}?${s}` : here;
}

export default async function Title({
  params,
  searchParams,
}: {
  params: Promise<{ via: string; kind: string; id: string }>;
  searchParams: Promise<{ change?: string; part?: string; sq?: string }>;
}) {
  const raw = await params;
  const route = parseTitleRoute(raw.via, raw.kind, raw.id);
  if (!route) notFound();
  const { via, kind, id: idNum } = route;
  const slug = via;
  const mediaKind = kind;
  const sp = await searchParams;
  const change = sp.change === "1";
  const q = sp.sq?.trim() ?? "";

  const seriesR = await fetchSeries(slug, mediaKind, idNum);
  const series = seriesR.ok && seriesR.value.parts.length > 0 ? seriesR.value : null;
  if (series && series.rootId !== idNum) {
    const q = new URLSearchParams();
    q.set("part", String(idNum));
    if (change) q.set("change", "1");
    redirect(`/title/${via}/${kind}/${series.rootId}?${q}`);
  }

  const media = await fetchTitle(slug, mediaKind, idNum);

  if (!media.ok) {
    return (
      <>
        <TopBar active={navTabForKind(mediaKind)} />
        <main>
          <Failed reason={media.reason} />
        </main>
      </>
    );
  }

  const m = media.value;
  const here = `/title/${m.via}/${m.kind}/${m.id}`;
  const firstId = series?.parts[0]?.id ?? m.id;
  const allParts = series ? [...series.parts, ...series.specials] : [];
  const viewingSpecials = sp.part === "specials";
  const wanted = Number(sp.part);
  const selectedMeta = viewingSpecials
    ? undefined
    : (allParts.find((p) => p.id === wanted) ?? series?.parts[0]);
  const selectedId = selectedMeta?.id ?? m.id;

  const selectedMedia =
    selectedId === m.id ? media : await fetchTitle(slug, mediaKind, selectedId);
  const selected = selectedMedia.ok ? selectedMedia.value : m;
  const forResolve =
    selectedMeta?.kind === "special" || !series
      ? selected
      : { ...selected, title: series.title };
  const selectedIsSpecial = selectedMeta?.kind === "special";

  // Each season's own episode count, so the flat episode list a source addon
  // returns can be sliced by absolute position instead of trusting whatever
  // season numbering that addon happens to use. See lib/series.ts windowEpisodes.
  const seriesParts = series?.parts ?? [];
  const wantsWindow = seriesParts.length > 1 && selectedMeta?.kind !== "special";

  // Source resolution and the season fetches are started here but awaited only
  // inside <Suspense> below: a slow or dead source must never hold the hero back.
  // A throw (as opposed to an Err) in the lookup becomes a Failed in the source section,
  // where it is awaited: it must not replace the whole page, hero and all.
  const resP: Promise<Result<Resolution> | null> = (
    viewingSpecials ? Promise.resolve(null) : resolveSource(forResolve, change || Boolean(q), q || undefined)
  ).catch((e) => {
    console.error("resolveSource threw", e);
    return Err<Resolution>("Looking up a source failed unexpectedly. Try again in a moment.");
  });
  const winP = (async () => {
    const partUnits = wantsWindow
      ? await Promise.all(
          seriesParts.map((p) =>
            p.id === m.id ? media : p.id === selectedId ? selectedMedia : fetchTitle(slug, mediaKind, p.id),
          ),
        )
      : ([] as Awaited<ReturnType<typeof fetchTitle>>[]);
    const { offset: episodeOffset, count: episodeCount } = wantsWindow
      ? episodeWindow(
          seriesParts.map((p, i) => ({ id: p.id, units: partUnits[i]?.ok ? partUnits[i].value.units : null })),
          selectedId,
        )
      : { offset: 0, count: selectedIsSpecial ? selected.units : null };
    return { partUnits, episodeOffset, episodeCount };
  })();
  // A rejection is surfaced where it is awaited; this only stops it being
  // reported as unhandled before the Suspense children get that far.
  winP.catch(() => {});
  const me = await currentProfile();

  const returnTo = partHref(here, viewingSpecials ? "specials" : selectedId, false, firstId);

  async function pick(formData: FormData) {
    "use server";
    pinBinding({
      via: selected.via,
      media_id: selected.id,
      source_id: String(formData.get("sourceId")),
      source_title: String(formData.get("sourceTitle")),
      source_manga_id: String(formData.get("sourceMangaId")),
      confidence: Number(formData.get("confidence")),
      backend: String(formData.get("backend") || "suwayomi"),
      kind: selected.kind,
    });
    redirect(returnTo);
  }

  const progressRow = getProgress(me.id, selected.via, selected.id);
  const libraryEntry = getLibrary(me.id, selected.via, selected.id) ?? null;
  // Side effect only (nothing in the hero reads it), so it must not hold the hero
  // either, and a failed award must not take the source list down with it.
  const awarded = progressRow
    ? awardForTitle(me.id, selected.via, selected.id, selected.kind, {
        seconds: progressRow.watched_seconds,
        unit: progressRow.unit,
      }).catch((e) => console.error("awardForTitle threw", e))
    : null;
  const anchor = parseAnchor(progressRow?.anchor ?? null);
  const readingId =
    anchor && "chapterId" in anchor && anchor.chapterId != null ? String(anchor.chapterId) : null;
  const unit = KIND_INFO[selected.kind].unitWord;
  const resume = readingId
    ? {
        href: `/read/${selected.via}/${selected.kind}/${selected.id}/${encodeURIComponent(readingId)}`,
        label: "Continue",
      }
    : null;
  const resumeHint =
    anchor?.kind === "page"
      ? `p.${anchor.index + 1}`
      : progressRow
        ? selected.kind === "movie"
          ? continueDetail(selected.kind, anchor) || null
          : unitPip(
              selected.kind,
              progressRow.unit,
              anchor?.kind === "seconds" ? anchor.season : null,
              anchor?.kind === "seconds" ? anchor.episode : null,
            )
        : null;

  // "Part 2" and "(2021)" are part of a film's or show's name, not a season suffix to strip.
  const heading = KIND_INFO[m.kind].franchise ? series?.title || seriesTitle(m.title) : m.title;
  // Movies and series are addressed by IMDb id: nothing to search, so nothing to hand-match.
  const byImdb = (m.kind === "movie" || m.kind === "series") && Boolean(selected.imdb);
  const specialsOn =
    viewingSpecials || (selectedMeta?.kind === "special" && selectedMeta.id === selectedId);
  const seasonHint = selectedIsSpecial
    ? 0
    : Number(/^Season (\d+)$/i.exec(selectedMeta?.label ?? "")?.[1] ?? "") || null;

  // Resuming needs no source; only the "Watch" fallback waits on the binding.
  async function Cta() {
    const [res, win] = resume ? [null, null] : await Promise.all([resP, winP]);
    return (
      <WatchCta
        resume={resume}
        pageLabel={resumeHint}
        binding={res?.ok ? res.value.binding : null}
        kind={selected.kind}
        via={selected.via}
        id={selected.id}
        episodeOffset={win?.episodeOffset}
        episodeCount={win?.episodeCount}
        seasonHint={seasonHint}
      />
    );
  }

  // Everything that depends on a source answering. Failures render here, in place.
  async function Source() {
    const [res, { partUnits, episodeOffset, episodeCount }] = await Promise.all([resP, winP, awarded]);
    const resolution = res?.ok ? res.value : null;
    const binding = resolution?.binding ?? null;
    if (!resolution) {
      return <Failed reason={res && !res.ok ? res.reason : "Unknown resolution error."} />;
    }
    return (
      <>
        {resolution.tier === "none" && byImdb && (
          <div className="empty">
            <b>No video source installed</b>
            Add a repository in <Link href="/sources">Sources</Link>, then this page finds a stream by its IMDb id.
          </div>
        )}

        {resolution.tier === "none" && !byImdb && (
          <div className="empty">
            <b>{q ? `Nothing matched “${q}”` : "No source has this yet"}</b>
            {q
              ? "Try the English title, or the original. Some sources only list one."
              : resolution.failures.length > 0
                ? `Searched every installed source. ${resolution.failures.join(" ")}`
                : "Add a source repository, then this page will find it automatically. Or search by another name below."}
          </div>
        )}

        {!byImdb && (change || q || resolution.tier === "none") && (
          <SourceQuery
            here={here}
            part={selectedId !== firstId ? String(selectedId) : undefined}
            q={q}
          />
        )}

        {resolution.failures.length > 0 && resolution.tier !== "none" && (
          <div className="note">
            <span className="dot" style={{ background: "var(--warn)" }} />
            Some sources didn&apos;t answer: {resolution.failures.join(" ")}
          </div>
        )}

        {binding && resolution.tier === "weak" && (
          <WeakMatchNote
            storeKey={weakDismissKey(selected.via, selected.kind, selected.id)}
            sourceTitle={binding.source_title}
            confidence={binding.confidence}
            href={change ? returnTo : `${returnTo}${returnTo.includes("?") ? "&" : "?"}change=1#alternatives`}
            change={change}
          />
        )}

        {binding && (
          <Suspense fallback={<SourcePending />}>
            <TitleChapters
              binding={binding}
              kind={selected.kind}
              via={selected.via}
              id={selected.id}
              readingId={readingId}
              readUnit={progressRow?.unit ?? 0}
              progress={{
                via: selected.via,
                mediaId: selected.id,
                kind: selected.kind,
                title: selected.title,
                cover: selected.cover,
                durationSeconds: selected.unitMinutes ? selected.unitMinutes * 60 : null,
                ...(wantsWindow ? progressTree(seriesParts, selectedId, partUnits) : {}),
              }}
              here={returnTo}
              hideSeasonChips={Boolean(series && series.parts.length > 1)}
              seasonHint={seasonHint}
              episodeOffset={episodeOffset}
              episodeCount={episodeCount}
              completed={libraryEntry?.status === "completed"}
            />
          </Suspense>
        )}

        {binding && binding.source_id === IMDB_SOURCE && (
          <div className="srcchip">
            Streaming from <b>your video sources</b>
            <span className="mono">{selected.imdb}</span>
          </div>
        )}

        {binding && binding.source_id !== IMDB_SOURCE && resolution.tier === "confident" && (
          <div className="srcchip">
            {KIND_INFO[selected.kind].video ? "Watching from" : "Reading from"} <b>{binding.source_title}</b>
            <span className="mono">{Math.round(binding.confidence * 100)}% match</span>
            {binding.pinned ? <span className="mono">pinned</span> : null}
            <Link prefetch={false} href={change ? returnTo : `${returnTo}${returnTo.includes("?") ? "&" : "?"}change=1#alternatives`}>
              {change ? "Never mind" : "Change"}
            </Link>
          </div>
        )}

        {(change || q || resolution.tier === "none") && resolution.candidates.length > 0 && (
          <MatchList
            candidates={resolution.candidates}
            expectedTitles={searchTitles(forResolve.title, [...(forResolve.aliases ?? []), q])}
            unit={unit}
            backendName={backend(selected.kind).name.toLowerCase()}
            pick={pick}
          />
        )}
      </>
    );
  }

  return (
    <>
        <TopBar active={navTabForKind(m.kind)} />

      <div
        className="hero"
        style={{ backgroundImage: `url(${m.banner ?? m.cover ?? ""})`, minHeight: 320 }}
      >
        <h1>{heading}</h1>
        <div className="meta">
          {m.score && <span className="badge">{m.score}% rated</span>}
          <span className="badge">{m.kind}</span>
          {m.year ? <span className="badge">{m.year}</span> : null}
          {m.kind === "movie" ? (
            m.unitMinutes ? <span className="badge">{m.unitMinutes} min</span> : null
          ) : (
            selected.units && !viewingSpecials && (
              <span className="badge">
                {selected.units} {selected.unitLabel}
              </span>
            )
          )}
          <span style={{ color: "var(--tx3)", fontSize: 12 }}>{m.genres.slice(0, 3).join(" · ")}</span>
        </div>
        <p>{m.description}</p>
        <div className="acts">
          {/* Holds the button's slot so the library menu does not jump when it lands. */}
          <Suspense fallback={<span className="btn skel" aria-hidden="true" style={{ width: 128 }} />}>
            <Cta />
          </Suspense>
          <LibraryMenu
            media={{
              via: selected.via,
              id: selected.id,
              kind: selected.kind,
              title: selected.title,
              cover: selected.cover,
              color: selected.color,
              units: selected.units,
              genres: selected.genres,
            }}
            entry={libraryEntry}
          />
        </div>
      </div>

      <main>
        {series && (series.parts.length > 1 || series.specials.length > 0) && (
          <div className="filters" style={{ margin: "-8px 0 0" }}>
            {series.parts.map((p) => (
              <Link
                prefetch={false}
                key={p.id}
                className={`chip${p.id === selectedId && !viewingSpecials ? " on" : ""}`}
                href={partHref(here, p.id, change, firstId)}
              >
                {p.label}
              </Link>
            ))}
            {series.specials.length > 0 && (
              <Link
                prefetch={false}
                className={`chip${specialsOn ? " on" : ""}`}
                href={partHref(here, "specials", change, firstId)}
              >
                Specials
              </Link>
            )}
          </div>
        )}

        {viewingSpecials && series ? (
          <SpecialsList series={series} here={here} change={change} firstId={firstId} />
        ) : (
          <Suspense fallback={<SourcePending />}>
            <Source />
          </Suspense>
        )}
      </main>
    </>
  );
}

/** Holds the shape of the episode/chapter list while the source answers. */
function SourcePending() {
  return (
    <section aria-hidden="true">
      <div className="row-h" style={{ height: 34, alignItems: "center" }}>
        <span className="skel skel-line" />
      </div>
      <div className="rows">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="row skel" style={{ minHeight: 52 }} />
        ))}
      </div>
    </section>
  );
}

function SourceQuery({
  here,
  part,
  q,
}: {
  here: string;
  part?: string;
  q: string;
}) {
  return (
    <form method="get" action={here} style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      <input type="hidden" name="change" value="1" />
      {part ? <input type="hidden" name="part" value={part} /> : null}
      <input
        name="sq"
        type="search"
        defaultValue={q}
        placeholder="Try another name"
        aria-label="Search sources by another name"
        style={{ flex: 1, minWidth: 180, maxWidth: 420 }}
      />
      <button className="btn" type="submit">
        Search sources
      </button>
    </form>
  );
}

function SpecialsList({
  series,
  here,
  change,
  firstId,
}: {
  series: Series;
  here: string;
  change: boolean;
  firstId: number;
}) {
  return (
    <section>
      <div className="row-h">
        <h2>Specials</h2>
        <span className="mono">{series.specials.length} available</span>
      </div>
      <div className="rows">
        {series.specials.map((s) => (
          <Link prefetch={false} className="row" key={s.id} href={partHref(here, s.id, change, firstId)}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h3>{s.label}</h3>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
