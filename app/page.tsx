import Link from "next/link";
import TopBar from "@/components/TopBar";
import Rail from "@/components/Rail";
import ContinueRail from "@/components/ContinueRail";
import { Degraded, Failed, Unavailable } from "@/components/ui";
import { gateHome, homeNeeds, keepKinds, kindList, pickHero } from "@/lib/browse";
import { visibleFor } from "@/lib/kinds-server";
import { fetchHome } from "@/lib/metadata";
import { currentProfile, topGenre } from "@/lib/profile";
import { continueReading, heroAction } from "@/lib/progress";

export const dynamic = "force-dynamic";

export default async function Home() {
  const me = await currentProfile();
  const kinds = visibleFor(me.id);
  const genre = topGenre(me.id);
  const need = homeNeeds(kinds);
  // Hidden categories are never requested, so a dead provider for one can't touch Home.
  const home = await fetchHome(genre, need.rails, need.feed);
  // Local rows, so this survives every provider being down. Over-read: hidden kinds are dropped after.
  const resume = keepKinds(continueReading(me.id, 42), kinds).slice(0, 14);

  if (!home.ok) {
    return (
      <>
        <TopBar active="Home" />
        <main>
          <Failed reason={home.reason} lastSuccess={home.lastSuccess} />
          <ContinueRail items={resume} />
        </main>
      </>
    );
  }

  const { via, degraded, failed = [] } = home.value;
  // Hidden kinds' rails come back empty (a Rail renders nothing then), so no per-rail guard is needed.
  const data = gateHome(home.value.data, kinds);
  const { popularAnime, popularManga, novels, forYou, popularMovies, popularSeries } = data;
  // The feed only supplies a hero for the anime family; otherwise open on the first rail with art.
  const hero = pickHero(data, kinds);
  const art = hero?.banner ?? hero?.cover;
  const billboard = hero ? heroAction(hero, resume) : null;

  return (
    <>
      <TopBar active="Home" />

      {hero && billboard && (
        <div
          className="hero"
          style={{ backgroundImage: art ? `url(${art})` : undefined }}
        >
          <div className="mono">Trending now</div>
          <h1>{hero.title}</h1>
          <div className="meta">
            {hero.score && <span className="badge">{hero.score}% rated</span>}
            <span className="badge">{cap(hero.kind)}</span>
            {hero.units && hero.kind !== "movie" && (
              <span className="badge">
                {hero.units} {hero.unitLabel}
              </span>
            )}
            <span style={{ color: "var(--tx3)", fontSize: 12 }}>
              {hero.genres.slice(0, 3).join(" · ")}
            </span>
          </div>
          <p>{hero.description}</p>
          <div className="acts">
            <Link className="btn primary" href={billboard.primary.href}>
              {billboard.primary.label}
            </Link>
            {billboard.secondary && (
              <Link className="btn" href={billboard.secondary.href}>
                {billboard.secondary.label}
              </Link>
            )}
          </div>
        </div>
      )}

      <main>
        {degraded && <Degraded via={via} />}
        {/* Continue lives on Home only — Yours is permanent, Home is temporal.
            Rail renders nothing when empty, so a new profile sees no shell. */}
        {resume.length > 0 && <ContinueRail items={resume} />}
        <Rail title="Popular this week" items={popularAnime} action="See all" href="/anime" priority />
        <Rail title={`Because you like ${genre.toLowerCase()}`} items={forYou} action="Why this?" />
        <Rail title="Popular manga" items={popularManga} action="See all" href="/manga" />
        <Rail title="Top novels" items={novels} action="See all" href="/novels" />
        {/* A dead movie or series chain says so; an empty rail is never the way it is told. */}
        {failed.length > 0 && <Unavailable note what={kindList(failed)} retry="/" />}
        {!failed.includes("movie") && (
          <Rail title="Popular movies" items={popularMovies} action="See all" href="/movies" />
        )}
        {!failed.includes("series") && (
          <Rail title="Popular series" items={popularSeries} action="See all" href="/series" />
        )}
      </main>
    </>
  );
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
