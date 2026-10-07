import { Suspense } from "react";
import TopBar from "@/components/TopBar";
import SearchResults from "@/components/SearchResults";
import { Degraded, Failed, Unavailable } from "@/components/ui";
import { kindList, searchGroups } from "@/lib/browse";
import { currentVisibleKinds } from "@/lib/kinds-server";
import { fetchSearch } from "@/lib/metadata";

export const dynamic = "force-dynamic";

export default async function Search({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const q = ((await searchParams).q ?? "").trim();
  // Hidden categories are neither fetched nor grouped.
  const kinds = await currentVisibleKinds();
  const result = q ? await fetchSearch(q, kinds) : null;
  const groups = result?.ok ? searchGroups(result.value.data, kinds) : [];

  return (
    <>
      <TopBar active="" />
      <main>
        {!q ? (
          <div className="empty">
            <b>Search everything</b>
            Type a title. Results group {kindList(kinds).toLowerCase()}. Press / from anywhere
            to focus, arrows to move, Enter to open.
          </div>
        ) : !result ? null : !result.ok ? (
          <Failed reason={result.reason} lastSuccess={result.lastSuccess} />
        ) : (
          <>
            {result.value.degraded && <Degraded via={result.value.via} />}
            {/* One chain dying leaves the other results; say which, never a quiet gap. */}
            {result.value.failed && (
              <Unavailable note what={kindList(result.value.failed)} retry={`/search?q=${encodeURIComponent(q)}`} />
            )}
            {groups.every((g) => g.items.length === 0) ? (
              <div className="empty">
                <b>No titles match “{q}”</b>
                Check the spelling, or try the original name.
              </div>
            ) : (
              <Suspense>
                <SearchResults groups={groups} />
              </Suspense>
            )}
          </>
        )}
      </main>
    </>
  );
}
