import TopBar from "@/components/TopBar";
import Rail from "@/components/Rail";
import { Degraded, Failed, Poster } from "@/components/ui";
import { fetchHome } from "@/lib/metadata";
import { currentProfile, topGenre } from "@/lib/profile";
import { continueReading, type ContinueItem } from "@/lib/progress";

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
          <Continue items={resume} />
        </main>
      </>
    );
  }

  const { data, via, degraded } = home.value;
  const { hero, popularAnime, popularManga, novels, forYou } = data;
  const art = hero?.banner ?? hero?.cover;

  return (
    <>
      <TopBar active="Home" />

      {hero && (
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
            <a className="btn primary" href={`/title/${hero.via}/${hero.kind}/${hero.id}`}>
              Details
            </a>
            <button className="btn">+ My list</button>
          </div>
        </div>
      )}

      <main>
        {degraded && <Degraded via={via} />}
        {/* Continue lives on Home only — Yours is permanent, Home is temporal.
            Rail renders nothing when empty, so a new profile sees no shell. */}
        <Continue items={resume} />
        <Rail title="Popular this week" items={popularAnime} action="See all" href="/anime" />
        <Rail title={`Because you like ${genre.toLowerCase()}`} items={forYou} action="Why this?" />
        <Rail title="Popular manga" items={popularManga} action="See all" href="/manga" />
        <Rail title="Top novels" items={novels} action="See all" href="/novels" />
      </main>
    </>
  );
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function Continue({ items }: { items: ContinueItem[] }) {
  if (items.length === 0) return null;
  return (
    <section>
      <div className="row-h">
        <h2>Continue</h2>
      </div>
      <div className="shelf">
        {items.map((m) => (
          <Poster key={`${m.kind}-${m.id}`} media={m} />
        ))}
      </div>
    </section>
  );
}
