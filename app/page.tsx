import TopBar from "@/components/TopBar";
import Rail from "@/components/Rail";
import ContinueRail from "@/components/ContinueRail";
import { Degraded, Failed } from "@/components/ui";
import { fetchHome } from "@/lib/metadata";
import { currentProfile, topGenre } from "@/lib/profile";
import { continueReading, heroAction } from "@/lib/progress";

export const dynamic = "force-dynamic";

export default async function Home() {
  const me = await currentProfile();
  const genre = topGenre(me.id);
  const home = await fetchHome(genre);
  // Local rows, so this survives every provider being down.
  const resume = continueReading(me.id);

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

  const { data, via, degraded } = home.value;
  const { hero, popularAnime, popularManga, novels, forYou } = data;
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
            {hero.units && (
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
            <a className="btn primary" href={billboard.primary.href}>
              {billboard.primary.label}
            </a>
            {billboard.secondary && (
              <a className="btn" href={billboard.secondary.href}>
                {billboard.secondary.label}
              </a>
            )}
          </div>
        </div>
      )}

      <main>
        {degraded && <Degraded via={via} />}
        {/* Continue lives on Home only — Yours is permanent, Home is temporal.
            Rail renders nothing when empty, so a new profile sees no shell. */}
        {resume.length > 0 && <ContinueRail items={resume} />}
        <Rail title="Popular this week" items={popularAnime} action="See all" href="/anime" />
        <Rail title={`Because you like ${genre.toLowerCase()}`} items={forYou} action="Why this?" />
        <Rail title="Popular manga" items={popularManga} action="See all" href="/manga" />
        <Rail title="Top novels" items={novels} action="See all" href="/novels" />
      </main>
    </>
  );
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
