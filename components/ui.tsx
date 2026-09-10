import type { Media } from "@/lib/media";

/**
 * A rail tile is a Media plus two optional overrides: Continue points straight
 * at the reader and carries a chapter pip. Extending Media rather than wrapping
 * it keeps every existing caller passing plain Media.
 */
export type RailItem = Media & { pip?: string; href?: string };

export function Poster({ media, selected }: { media: RailItem; selected?: boolean }) {
  return (
    <a
      className={`poster${selected ? " sel" : ""}`}
      href={media.href ?? `/title/${media.via}/${media.kind}/${media.id}`}
      style={bg(media)}
    >
      {media.cover && <img src={media.cover} alt="" loading="lazy" decoding="async" />}
      {media.pip && <span className="new-pip">{media.pip}</span>}
      <span className="cap">{media.title}</span>
    </a>
  );
}

/** Cover colour behind the image so the rail never flashes empty while loading. */
const bg = (m: Media) => ({ background: m.color ?? "var(--s2)" });

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
