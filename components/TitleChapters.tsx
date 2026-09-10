import { revalidatePath } from "next/cache";
import EpisodeList from "@/components/EpisodeList";
import type { Binding } from "@/lib/match";
import type { MediaKind } from "@/lib/media";
import { chaptersFor } from "@/lib/resolve";

export default async function TitleChapters({
  binding,
  kind,
  via,
  id,
  readingId,
  here,
  hideSeasonChips,
  seasonHint,
}: {
  binding: Binding;
  kind: MediaKind;
  via: string;
  id: number;
  readingId: string | null;
  here: string;
  hideSeasonChips?: boolean;
  seasonHint?: number | null;
}) {
  const chapters = await chaptersFor(binding);

  async function refresh() {
    "use server";
    await chaptersFor(binding, true);
    revalidatePath(here);
  }

  if (!chapters.ok) {
    return (
      <div className="empty">
        <b>Could not load {kind === "anime" ? "episodes" : "chapters"}</b>
        {chapters.reason} Try another match below, or refresh.
      </div>
    );
  }

  return (
    <section>
      <div className="row-h">
        <h2>{kind === "anime" ? "Episodes" : "Chapters"}</h2>
        <span className="mono">{chapters.value.length} available</span>
        <form action={refresh} style={{ marginLeft: "auto" }}>
          <button className="btn" type="submit">
            Refresh
          </button>
        </form>
      </div>
      {chapters.value.length === 0 ? (
        <div className="empty">
          <b>This source lists no chapters</b>
          The entry exists but has nothing to {kind === "anime" ? "watch" : "read"} — often a
          takedown. Try another match below.
        </div>
      ) : kind === "anime" ? (
        <EpisodeList
          episodes={chapters.value}
          readingId={readingId}
          base={`/read/${via}/${kind}/${id}/`}
          hideSeasons={hideSeasonChips}
          seasonHint={seasonHint}
        />
      ) : (
        <div className="rows scrollbox">
          {chapters.value.map((c) => (
            <a
              className={`row${c.id === readingId ? " here" : ""}`}
              key={c.id}
              href={`/read/${via}/${kind}/${id}/${encodeURIComponent(c.id)}`}
            >
              <span className="mono" style={{ width: 56 }}>
                {c.number}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3>{c.name}</h3>
                {c.scanlator && <span className="url">{c.scanlator}</span>}
              </div>
              {c.id === readingId && <span className="badge">reading</span>}
              {c.pageCount ? <span className="badge">{c.pageCount}p</span> : null}
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
