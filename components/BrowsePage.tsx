import Link from "next/link";
import TopBar from "@/components/TopBar";
import Rail from "@/components/Rail";
import { Degraded, Poster, Unavailable } from "@/components/ui";
import { sameTitles } from "@/lib/browse";
import type { MediaKind } from "@/lib/media";
import { browseGenres, fetchBrowse } from "@/lib/metadata";
import { currentProfile, profileGenres } from "@/lib/profile";
import { KIND_INFO } from "@/lib/kinds";
import { visibleFor } from "@/lib/kinds-server";

function href(kind: MediaKind, genre: string | null, page?: number): string {
  const base = KIND_INFO[kind].route;
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
  const { label } = KIND_INFO[kind];
  const genres = browseGenres(kind);
  const me = await currentProfile();
  // A hidden category still answers (200, no redirect: bookmarks keep working), but fetches nothing.
  if (!visibleFor(me.id).includes(kind)) {
    return (
      <>
        <TopBar active="" />
        <main>
          <div className="empty" role="status">
            <b>{label} is hidden</b>
            You turned this category off. Your library and progress for it are untouched.
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <Link prefetch={false} className="btn" href="/settings">
                Turn it on in Settings
              </Link>
            </div>
          </div>
        </main>
      </>
    );
  }
  const genre = genres.find((g) => g === q.genre) ?? null;
  const page = Math.max(1, Number(q.page) || 1);
  const taste = profileGenres(me.id);
  const rec = genre ?? taste.find((g) => genres.includes(g)) ?? "Adventure";
  const result = await fetchBrowse(kind, genre, page, taste);

  return (
    <>
      <TopBar active={label} />
      <main>
        <div className="filters">
          <Link prefetch={false} className={`chip${genre ? "" : " on"}`} href={href(kind, null)}>
            All
          </Link>
          {genres.map((g) => (
            <Link prefetch={false} key={g} className={`chip${genre === g ? " on" : ""}`} href={href(kind, g)}>
              {g}
            </Link>
          ))}
        </div>

        {!result.ok ? (
          <Unavailable
            what={label}
            reason={result.reason}
            lastSuccess={result.lastSuccess}
            retry={href(kind, genre, page)}
          />
        ) : (
          <>
            {result.value.degraded && <Degraded via={result.value.via} />}
            <Rail title="Popular now" items={result.value.data.popular} priority />
            {!genre &&
              result.value.data.rails.map((r) => (
                <Rail key={r.genre} title={r.genre} items={r.items} href={href(kind, r.genre)} action="See all" />
              ))}
            {/* A provider with nothing to personalise from hands back its popular list. */}
            {!sameTitles(result.value.data.recommended, result.value.data.popular) && (
              <Rail
                title={`Because you like ${rec.toLowerCase()}`}
                items={result.value.data.recommended}
              />
            )}
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
                    <Link prefetch={false} className="btn" href={href(kind, genre, page - 1)}>
                      Previous
                    </Link>
                  ) : (
                    <span />
                  )}
                  {result.value.data.hasMore && (
                    <Link prefetch={false} className="btn" href={href(kind, genre, page + 1)}>
                      Next
                    </Link>
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
