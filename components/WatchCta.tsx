import { firstPlay, playHref, playLabel } from "@/lib/nav";
import type { Binding } from "@/lib/match";
import type { MediaKind } from "@/lib/media";
import { chaptersFor } from "@/lib/resolve";

export default async function WatchCta({
  resume,
  pageLabel,
  binding,
  kind,
  via,
  id,
  episodeOffset = 0,
  episodeCount = null,
  seasonHint = null,
}: {
  resume: { href: string; label: string } | null;
  pageLabel?: string | null;
  binding: Binding | null;
  kind: MediaKind;
  via: string;
  id: number;
  episodeOffset?: number;
  episodeCount?: number | null;
  seasonHint?: number | null;
}) {
  if (resume) {
    return (
      <a className="btn primary" href={resume.href}>
        {resume.label}
        {pageLabel ? (
          <span className="mono" style={{ color: "inherit", opacity: 0.7 }}>
            {pageLabel}
          </span>
        ) : null}
      </a>
    );
  }
  if (!binding) return null;
  const chapters = await chaptersFor(binding);
  if (!chapters.ok) return null;
  const first = firstPlay(kind, chapters.value, {
    offset: episodeOffset,
    count: episodeCount,
    seasonHint,
  });
  if (!first) return null;
  return (
    <a className="btn primary" href={playHref(via, kind, id, first.id)}>
      {playLabel(kind, first.number)}
    </a>
  );
}
