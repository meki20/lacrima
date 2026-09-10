import TopBar from "@/components/TopBar";
import Rail from "@/components/Rail";
import { Degraded, Failed, Poster } from "@/components/ui";
import { GENRES, type MediaKind } from "@/lib/media";
import { fetchBrowse } from "@/lib/metadata";
import { currentProfile, profileGenres } from "@/lib/profile";

const TABS: Record<MediaKind, string> = {
  anime: "Anime",
  manga: "Manga",
  novel: "Novels",
};

function href(kind: MediaKind, genre: string | null, page?: number): string {
  const base = kind === "novel" ? "/novels" : `/${kind}`;
  const q = new URLSearchParams();
  if (genre) q.set("genre", genre);
  if (page && page > 1) q.set("page", String(page));
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

export default async function BrowsePage({
  kind,
  searchParams,
}: {
  kind: MediaKind;
  searchParams: Promise<{ genre?: string; page?: string }>;
}) {
  const q = await searchParams;
  const genre = GENRES.includes(q.genre as (typeof GENRES)[number]) ? q.genre! : null;
  const page = Math.max(1, Number(q.page) || 1);
  const me = await currentProfile();
  const taste = profileGenres(me.id);
  const rec = genre ?? taste[0] ?? "Adventure";
  const result = await fetchBrowse(kind, genre, page, taste);

  return (
    <>
      <TopBar active={TABS[kind]} />
      <main>
        <div className="filters">
          <a className={`chip${genre ? "" : " on"}`} href={href(kind, null)}>
            All
          </a>
          {GENRES.map((g) => (
            <a key={g} className={`chip${genre === g ? " on" : ""}`} href={href(kind, g)}>
              {g}
            </a>
          ))}
        </div>

        {!result.ok ? (
          <Failed reason={result.reason} lastSuccess={result.lastSuccess} />
        ) : (
          <>
            {result.value.degraded && <Degraded via={result.value.via} />}
            <Rail title="Popular now" items={result.value.data.popular} />
            {!genre &&
              result.value.data.rails.map((r) => (
                <Rail key={r.genre} title={r.genre} items={r.items} href={href(kind, r.genre)} action="See all" />
              ))}
            <Rail
              title={`Because you like ${rec.toLowerCase()}`}
              items={result.value.data.recommended}
            />
            <Rail title="Recently added" items={result.value.data.recent} />
            <section>
              <div className="row-h">
                <h2>{genre ?? "All titles"}</h2>
              </div>
              {result.value.data.grid.length === 0 ? (
                <div className="empty">
                  <b>Nothing in this genre yet</b>
                  Try another filter, or search by name.
                </div>
              ) : (
                <div className="grid">
                  {result.value.data.grid.map((m) => (
                    <Poster key={`${m.via}-${m.kind}-${m.id}`} media={m} />
                  ))}
                </div>
              )}
              {(page > 1 || result.value.data.hasMore) && (
                <div className="pager">
                  {page > 1 ? (
                    <a className="btn" href={href(kind, genre, page - 1)}>
                      Previous
                    </a>
                  ) : (
                    <span />
                  )}
                  {result.value.data.hasMore && (
                    <a className="btn" href={href(kind, genre, page + 1)}>
                      Next
                    </a>
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}
