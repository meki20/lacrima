import { Suspense } from "react";
import { redirect } from "next/navigation";
import MatchList from "@/components/MatchList";
import TitleChapters from "@/components/TitleChapters";
import TopBar from "@/components/TopBar";
import WatchCta from "@/components/WatchCta";
import WeakMatchNote from "@/components/WeakMatchNote";
import { Failed } from "@/components/ui";
import type { MediaKind, ProviderSlug } from "@/lib/media";
import { searchTitles } from "@/lib/match";
import { weakDismissKey } from "@/lib/weak-note";
import { fetchTitle } from "@/lib/metadata";
import { navTabForKind } from "@/lib/nav";
import { currentProfile } from "@/lib/profile";
import { getProgress, parseAnchor, unitPip } from "@/lib/progress";
import { pinBinding, resolveSource } from "@/lib/resolve";
import { backend } from "@/lib/sources";
import { episodeWindow, fetchSeries, seriesTitle, type Series } from "@/lib/series";

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
  const { via, kind, id } = await params;
  const sp = await searchParams;
  const change = sp.change === "1";
  const q = sp.sq?.trim() ?? "";
  const idNum = Number(id);
  const slug = via as ProviderSlug;
  const mediaKind = kind as MediaKind;

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
      : { ...m, title: series.title, aliases: selected.aliases };

  // Each season's own episode count, so the flat episode list a source addon
  // returns can be sliced by absolute position instead of trusting whatever
  // season numbering that addon happens to use. See lib/series.ts windowEpisodes.
  const seriesParts = series?.parts ?? [];
  const wantsWindow = seriesParts.length > 1 && selectedMeta?.kind !== "special";

  const [res, me, partUnits] = await Promise.all([
    viewingSpecials ? Promise.resolve(null) : resolveSource(forResolve, change || Boolean(q), q || undefined),
    currentProfile(),
    wantsWindow
      ? Promise.all(
          seriesParts.map((p) =>
            p.id === m.id ? media : p.id === selectedId ? selectedMedia : fetchTitle(slug, mediaKind, p.id),
          ),
        )
      : Promise.resolve([] as Awaited<ReturnType<typeof fetchTitle>>[]),
  ]);

  const { offset: episodeOffset, count: episodeCount } = wantsWindow
    ? episodeWindow(
        seriesParts.map((p, i) => ({ id: p.id, units: partUnits[i]?.ok ? partUnits[i].value.units : null })),
        selectedId,
      )
    : { offset: 0, count: null };

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

  const resolution = res?.ok ? res.value : null;
  const binding = resolution?.binding ?? null;
  const progressRow = getProgress(me.id, selected.via, selected.id);
  const anchor = parseAnchor(progressRow?.anchor ?? null);
  const readingId =
    anchor?.kind === "page" || anchor?.kind === "seconds" ? String(anchor.chapterId) : null;
  const unit = selected.kind === "anime" ? "episode" : "chapter";
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
        ? unitPip(selected.kind, progressRow.unit, anchor?.kind === "seconds" ? anchor.season : null)
        : null;

  const heading = series?.title || seriesTitle(m.title);
  const specialsOn =
    viewingSpecials || (selectedMeta?.kind === "special" && selectedMeta.id === selectedId);
  const seasonHint = Number(/^Season (\d+)$/i.exec(selectedMeta?.label ?? "")?.[1] ?? "") || null;

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
          {selected.units && !viewingSpecials && (
            <span className="badge">
              {selected.units} {selected.unitLabel}
            </span>
          )}
          <span style={{ color: "var(--tx3)", fontSize: 12 }}>{m.genres.slice(0, 3).join(" · ")}</span>
        </div>
        <p>{m.description}</p>
        <Suspense fallback={null}>
          <WatchCta
            resume={resume}
            pageLabel={resumeHint}
            binding={binding}
            kind={selected.kind}
            via={selected.via}
            id={selected.id}
            episodeOffset={episodeOffset}
            episodeCount={episodeCount}
            seasonHint={seasonHint}
          />
        </Suspense>
      </div>

      <main>
        {series && (series.parts.length > 1 || series.specials.length > 0) && (
          <div className="filters" style={{ margin: "-8px 0 0" }}>
            {series.parts.map((p) => (
              <a
                key={p.id}
                className={`chip${p.id === selectedId && !viewingSpecials ? " on" : ""}`}
                href={partHref(here, p.id, change, firstId)}
              >
                {p.label}
              </a>
            ))}
            {series.specials.length > 0 && (
              <a
                className={`chip${specialsOn ? " on" : ""}`}
                href={partHref(here, "specials", change, firstId)}
              >
                Specials
              </a>
            )}
          </div>
        )}

        {viewingSpecials && series ? (
          <SpecialsList series={series} here={here} change={change} firstId={firstId} />
        ) : !resolution ? (
          <Failed reason={res && !res.ok ? res.reason : "Unknown resolution error."} />
        ) : (
          <>
            {binding && resolution.tier === "confident" && (
              <div className="srcchip">
                Reading from <b>{binding.source_title}</b>
                <span className="mono">{Math.round(binding.confidence * 100)}% match</span>
                {binding.pinned ? <span className="mono">pinned</span> : null}
                <a href={change ? returnTo : `${returnTo}${returnTo.includes("?") ? "&" : "?"}change=1#alternatives`}>
                  {change ? "Never mind" : "Change"}
                </a>
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

            {resolution.tier === "none" && (
              <div className="empty">
                <b>{q ? `Nothing matched “${q}”` : "No source has this yet"}</b>
                {q
                  ? "Try the English title, or the original. Some sources only list one."
                  : resolution.failures.length > 0
                    ? `Searched every installed source. ${resolution.failures.join(" ")}`
                    : "Add a source repository, then this page will find it automatically. Or search by another name below."}
              </div>
            )}

            {(change || q || resolution.tier === "none") && (
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

            {binding && (
              <Suspense
                fallback={
                  <div className="empty">
                    <b>{selected.kind === "anime" ? "Loading episodes" : "Loading chapters"}</b>
                  </div>
                }
              >
                <TitleChapters
                  binding={binding}
                  kind={selected.kind}
                  via={selected.via}
                  id={selected.id}
                  readingId={readingId}
                  here={returnTo}
                  hideSeasonChips={Boolean(series && series.parts.length > 1)}
                  seasonHint={seasonHint}
                  episodeOffset={episodeOffset}
                  episodeCount={episodeCount}
                />
              </Suspense>
            )}

            {resolution.candidates.length > 0 && (
              <MatchList
                candidates={resolution.candidates}
                expectedTitles={searchTitles(forResolve.title, [...(forResolve.aliases ?? []), q])}
                unit={unit}
                backendName={backend(selected.kind).name.toLowerCase()}
                pick={pick}
              />
            )}
          </>
        )}
      </main>
    </>
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
          <a className="row" key={s.id} href={partHref(here, s.id, change, firstId)}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h3>{s.label}</h3>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}
