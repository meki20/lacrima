import { revalidatePath } from "next/cache";
import EpisodeList from "@/components/EpisodeList";
import ChapterList from "@/components/ChapterList";
import type { Binding } from "@/lib/match";
import { isVideoKind } from "@/lib/kinds";
import type { MediaKind } from "@/lib/media";
import type { ProgressWrite } from "@/lib/progress-write";
import { chaptersFor } from "@/lib/resolve";
import { windowEpisodes } from "@/lib/series";
import { IMDB_SOURCE } from "@/lib/sources/stremio";

export default async function TitleChapters({
  binding,
  kind,
  via,
  id,
  readingId,
  readUnit,
  progress,
  here,
  hideSeasonChips,
  seasonHint,
  episodeOffset,
  episodeCount,
  completed = false,
}: {
  binding: Binding;
  kind: MediaKind;
  via: string;
  id: number;
  readingId: string | null;
  readUnit: number;
  progress: Omit<ProgressWrite, "unit" | "chapterId" | "chapterName" | "pages">;
  here: string;
  hideSeasonChips?: boolean;
  seasonHint?: number | null;
  episodeOffset?: number;
  episodeCount?: number | null;
  completed?: boolean;
}) {
  const chapters = await chaptersFor(binding);
  const video = isVideoKind(kind);
  /* An IMDb-bound title has no other match to offer; the episode list comes from the
     metadata provider, so the only thing to try is asking again. */
  const lookup = binding.source_id === IMDB_SOURCE;

  async function refresh() {
    "use server";
    await chaptersFor(binding, true);
    revalidatePath(here);
  }

  if (!chapters.ok) {
    return (
      <div className="empty">
        <b>Could not load {video ? "episodes" : "chapters"}</b>
        {chapters.reason} {lookup ? "Reload the page to try again." : "Try another match below, or refresh."}
      </div>
    );
  }

  const visible =
    kind === "anime" && hideSeasonChips
      ? windowEpisodes(chapters.value, episodeOffset ?? 0, episodeCount ?? null, seasonHint ?? null)
      : chapters.value;
  // A film is one synthetic entry: the hero's Watch button is the whole interface.
  if (kind === "movie" && visible.length === 1) return null;
  const missingSpecial = kind === "anime" && seasonHint === 0 && visible.length === 0;

  return (
    <section>
      <div className="row-h">
        <h2>{video ? "Episodes" : "Chapters"}</h2>
        <span className="mono">{visible.length} available</span>
        <form action={refresh} style={{ marginLeft: "auto" }}>
          <button className="btn" type="submit">
            Refresh
          </button>
        </form>
      </div>
      {visible.length === 0 ? (
        <div className="empty">
          <b>
            {missingSpecial
              ? "This source does not list this special"
              : `This source lists no ${video ? "episodes" : "chapters"}`}
          </b>
          {missingSpecial
            ? "The selected source only exposes the parent series. Try another match below."
            : `The entry exists but has nothing to ${video ? "watch" : "read"} — often a takedown. Try another match below.`}
        </div>
      ) : video ? (
        <EpisodeList
          episodes={visible}
          readingId={readingId}
          unit={readUnit}
          progress={progress}
          base={`/read/${via}/${kind}/${id}/`}
          indexOffset={kind === "anime" && hideSeasonChips ? episodeOffset ?? 0 : 0}
          completed={completed}
        />
      ) : (
        <ChapterList
          chapters={visible}
          readingId={readingId}
          unit={readUnit}
          progress={progress}
          completed={completed}
        />
      )}
    </section>
  );
}
