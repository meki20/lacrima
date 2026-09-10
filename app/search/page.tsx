import { Suspense } from "react";
import TopBar from "@/components/TopBar";
import SearchResults from "@/components/SearchResults";
import { Degraded, Failed } from "@/components/ui";
import { fetchSearch } from "@/lib/metadata";

export const dynamic = "force-dynamic";

export default async function Search({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const q = ((await searchParams).q ?? "").trim();
  const result = q ? await fetchSearch(q) : null;

  return (
    <>
      <TopBar active="" />
      <main>
        {!q ? (
          <div className="empty">
            <b>Search everything</b>
            Type a title. Results group anime, manga and novels. Press / from anywhere
            to focus, arrows to move, Enter to open.
          </div>
        ) : !result ? null : !result.ok ? (
          <Failed reason={result.reason} lastSuccess={result.lastSuccess} />
        ) : (
          <>
            {result.value.degraded && <Degraded via={result.value.via} />}
            {result.value.data.anime.length +
              result.value.data.manga.length +
              result.value.data.novels.length ===
            0 ? (
              <div className="empty">
                <b>No titles match “{q}”</b>
                Check the spelling, or try the Japanese name.
              </div>
            ) : (
              <Suspense>
                <SearchResults
                  groups={[
                    { title: "Anime", items: result.value.data.anime },
                    { title: "Manga", items: result.value.data.manga },
                    { title: "Novels", items: result.value.data.novels },
                  ]}
                />
              </Suspense>
            )}
          </>
        )}
      </main>
    </>
  );
}
