import Link from "next/link";
import type { Media } from "@/lib/media";
import PosterImg from "./PosterImg";

/**
 * A rail tile is a Media plus two optional overrides: Continue points straight
 * at the reader and carries a chapter pip. Extending Media rather than wrapping
 * it keeps every existing caller passing plain Media.
 */
export type RailItem = Media & { pip?: string; href?: string };

/**
 * `index` is the tile's place in the first rail on the page: the first few load
 * eagerly (the first two at high priority), everything else stays lazy.
 *
 * The preview is a hover/focus extra on fine pointers (CSS decides), built only
 * from what Media already carries and aria-hidden: the link's name stays the title.
 */
export function Poster({
  media,
  selected,
  index,
}: {
  media: RailItem;
  selected?: boolean;
  index?: number;
}) {
  const label = (media.units === 1 ? media.unitLabel?.replace(/s$/, "") : media.unitLabel) ?? "";
  const stats = [media.score ? `${media.score}%` : "", media.units ? `${media.units} ${label}`.trim() : ""]
    .filter(Boolean)
    .join(" · ");
  const genres = (media.genres ?? []).slice(0, 2).join(" · ");
  const blurb = media.description?.slice(0, 160);

  return (
    /* Dense rails and grids: a viewport prefetch per tile would be a server render
       each. Click still navigates on the client and shows the route's loading.tsx. */
    <Link
      prefetch={false}
      className={`poster${selected ? " sel" : ""}${media.cover ? "" : " nocover"}`}
      href={media.href ?? `/title/${media.via}/${media.kind}/${media.id}`}
      style={media.cover ? bg(media) : undefined}
    >
      {media.cover && (
        <PosterImg
          src={media.cover}
          eager={index !== undefined && index < 6}
          high={index !== undefined && index < 2}
        />
      )}
      {media.pip && <span className="new-pip">{media.pip}</span>}
      <span className="foot">
        {(stats || genres || blurb) && (
          <span className="pv" aria-hidden="true">
            {stats && <span className="pv-stats">{stats}</span>}
            {genres && <span>{genres}</span>}
            {blurb && <span className="pv-blurb">{blurb}</span>}
          </span>
        )}
        <span className="cap">{media.title}</span>
      </span>
    </Link>
  );
}

/**
 * The cover's colour, dimmed into the chrome. AniList's raw colours are saturated
 * enough to read as a loud slab against near-black while the image loads.
 */
const bg = (m: Media) => ({
  background: m.color ? `color-mix(in srgb, ${m.color} 35%, var(--s1))` : "var(--s2)",
});

/**
 * Never an empty grid for a failure (CLAUDE.md, data rule 2). Says what broke and
 * what happens next.
 */
export function Failed({ reason, lastSuccess }: { reason: string; lastSuccess?: number }) {
  return (
    <div className="empty">
      <b>Nothing to browse right now</b>
      {reason}
      {lastSuccess && ` Last worked ${new Date(lastSuccess).toLocaleString()}.`}
      {" Your library and downloads are unaffected."}
    </div>
  );
}

/**
 * The shape of a page whose metadata is still in flight.
 *
 * Navigation used to commit only once the server render finished, so a cold
 * browse sat on the previous screen for seconds with nothing to show for it.
 * The layout is already known, so hold its shape rather than perform a wait —
 * a fragment, so `main`'s own gap spaces these like the real rails.
 */
export function Pending({ rails = 2, tiles = 10 }: { rails?: number; tiles?: number }) {
  return (
    <>
      {Array.from({ length: rails }, (_, r) => (
        <section key={r} aria-hidden="true">
          <div className="row-h">
            <span className="skel skel-line" />
          </div>
          <div className="rail">
            {Array.from({ length: tiles }, (_, i) => (
              <div key={i} className="poster skel" />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

/** Quiet, honest note when a fallback provider served the page. */
export function Degraded({ via }: { via: string }) {
  return (
    <div className="note">
      <span className="dot" style={{ background: "var(--warn)" }} />
      Preferred metadata provider is unavailable — showing results from {via}.
    </div>
  );
}

/**
 * A category's metadata chain (movies, series) didn't answer. Names what is missing, says the
 * rest of the app is unaffected and offers the way forward — never a silent gap.
 * `note` is the quiet one-line form for standing in for a rail or a search group; without
 * it, the block fills a page whose only content was that catalogue.
 */
export function Unavailable({
  what,
  reason,
  lastSuccess,
  retry,
  note,
}: {
  /** Sentence-case name, e.g. "Movies" or "Movies and series". */
  what: string;
  reason?: string;
  lastSuccess?: number;
  /** Where "Try again" goes: the page that just failed. */
  retry?: string;
  note?: boolean;
}) {
  const again = retry && (
    <Link prefetch={false} className={note ? "note-dismiss" : "btn"} href={retry}>
      Try again
    </Link>
  );
  if (note) {
    return (
      <div className="note" role="status">
        <span className="dot" style={{ background: "var(--warn)" }} />
        {what} didn't answer. Everything else is unaffected.
        {again}
      </div>
    );
  }
  return (
    <div className="empty" role="status">
      <b>{what} didn't answer</b>
      {reason ? `${reason} ` : ""}
      {lastSuccess ? `Last worked ${new Date(lastSuccess).toLocaleString()}. ` : ""}
      The metadata catalogue is unreachable right now. Your library, progress and sources are unaffected,
      and titles you already have still open. Try again in a minute.
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        {again}
        <Link prefetch={false} className="btn" href="/yours">
          Open your library
        </Link>
      </div>
    </div>
  );
}
