import TopBar from "@/components/TopBar";
import LibrarySort from "@/components/LibrarySort";
import PinnedShelf from "@/components/PinnedShelf";
import {
  filterLibrary,
  libraryGenres,
  listLibrary,
  backfillLibrary,
  parseSort,
  parseStatus,
  progressLabel,
  shelfItems,
  sortLibrary,
  STATUS_LABEL,
  STATUSES,
} from "@/lib/library";
import type { MediaKind } from "@/lib/media";
import { allProfiles, currentProfile } from "@/lib/profile";
import { earnedCount } from "@/lib/stickers";
import {
  collectFacts,
  formatHours,
  formatStat,
  loadActivity,
  loadProgress,
  monthMix,
  wallStyle,
} from "@/lib/yours";

export const dynamic = "force-dynamic";

const KINDS: { id: MediaKind | ""; label: string }[] = [
  { id: "", label: "All" },
  { id: "anime", label: "Anime" },
  { id: "manga", label: "Manga" },
  { id: "novel", label: "Novels" },
];

function yoursHref(q: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `/yours?${s}` : "/yours";
}

export default async function Yours({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; status?: string; genre?: string; sort?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const me = await currentProfile();
  const people = allProfiles();
  const kind = (["anime", "manga", "novel"] as const).includes(sp.kind as MediaKind)
    ? (sp.kind as MediaKind)
    : null;
  const status = parseStatus(sp.status);
  const sort = parseSort(sp.sort);
  const q = sp.q?.trim() ?? "";
  const genre = sp.genre?.trim() || null;

  const activity = loadActivity(me.id);
  const progress = loadProgress(me.id);
  backfillLibrary(me.id);
  const items = listLibrary(me.id);
  const facts = collectFacts(items, progress, activity);
  const stickers = earnedCount(me.id);
  const mix = monthMix(activity);
  const shelf = shelfItems(items);
  const genres = libraryGenres(items);
  const shown = sortLibrary(filterLibrary(items, { kind, status, genre, q, sort }), sort);
  const joined = new Date(me.created_at).toLocaleString("en", { month: "long", year: "numeric" });
  const query: Record<string, string> = {};
  if (kind) query.kind = kind;
  if (status) query.status = status;
  if (genre) query.genre = genre;
  if (sort !== "added") query.sort = sort;
  if (q) query.q = q;

  return (
    <>
      <TopBar active="Yours" />
      <div className="yours-wall" style={wallStyle(me.wallpaper)}>
        <div className="greet">
          <div className="pfp greet-pfp" style={{ background: me.avatar_color }}>
            {me.name[0]?.toUpperCase()}
          </div>
          <div>
            <h1>{me.name}</h1>
            <div className="yours-sub">
              Joined {joined} · profile {people.findIndex((p) => p.id === me.id) + 1} of {people.length}
            </div>
          </div>
        </div>
        <div className="streak">
          <div className="stat">
            <b>{formatStat(facts.titles)}</b>
            <span>titles tracked</span>
          </div>
          <div className="stat">
            <b>{formatStat(facts.chapters)}</b>
            <span>chapters read</span>
          </div>
          <div className="stat">
            <b>{formatHours(facts.watchedSeconds)} h</b>
            <span>watched</span>
          </div>
          <div className="stat">
            <b>{formatStat(facts.streak)} d</b>
            <span>current streak</span>
          </div>
          <a className="stat" href="/stickers">
            <b>{formatStat(stickers)}</b>
            <span>stickers earned</span>
          </a>
        </div>
      </div>

      <main className="yours">
        <div className="yours-bento">
          <div className="tile tile-shelf">
            <PinnedShelf items={shelf} />
          </div>
          <div className="tile">
            <div className="row-h" style={{ margin: 0 }}>
              <h2>Most read this month</h2>
            </div>
            {mix.every((m) => m.n === 0) ? (
              <p className="yours-muted">Read or watch something and the mix will show up here.</p>
            ) : (
              <div className="mix-rows">
                {mix.map((m) => (
                  <div className="mix-row" key={m.kind}>
                    <span>{m.label}</span>
                    <div className="progress">
                      <i style={{ width: `${m.pct}%` }} />
                    </div>
                    <em>{m.pct}%</em>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="yours-library">
          <div className="row-h">
            <h2>Your library</h2>
            <span className="mono">{formatStat(items.length)} titles</span>
          </div>
          <div className="filters">
            {KINDS.map((k) => (
              <a
                key={k.label}
                className={`chip${(kind ?? "") === k.id ? " on" : ""}`}
                href={yoursHref({ ...query, kind: k.id || undefined })}
              >
                {k.label}
              </a>
            ))}
            <span className="filter-gap" />
            {STATUSES.map((s) => (
              <a
                key={s}
                className={`chip${status === s ? " on" : ""}`}
                href={yoursHref({ ...query, status: status === s ? undefined : s })}
              >
                {STATUS_LABEL[s]}
              </a>
            ))}
            <span className="spacer" />
            <LibrarySort value={sort} query={query} />
          </div>
          {genres.length > 0 && (
            <div className="filters">
              {genres.map((g) => (
                <a
                  key={g}
                  className={`chip${genre === g ? " on" : ""}`}
                  href={yoursHref({ ...query, genre: genre === g ? undefined : g })}
                >
                  {g}
                </a>
              ))}
            </div>
          )}
          <form className="yours-search" action="/yours" method="get">
            {kind && <input type="hidden" name="kind" value={kind} />}
            {status && <input type="hidden" name="status" value={status} />}
            {genre && <input type="hidden" name="genre" value={genre} />}
            {sort !== "added" && <input type="hidden" name="sort" value={sort} />}
            <input
              className="search"
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search your library"
              aria-label="Search your library"
            />
          </form>
          {shown.length === 0 ? (
            <div className="empty">
              <b>{items.length === 0 ? "Your library is empty" : "Nothing matches these filters"}</b>
              {items.length === 0
                ? "Open a title and add it, or just start reading — progress puts it here."
                : "Clear a filter, or search a different name."}
            </div>
          ) : (
            <div className="yours-grid">
              {shown.map((m) => (
                <a className="yours-card" key={`${m.via}-${m.kind}-${m.id}`} href={m.href}>
                  <div className="poster" style={{ background: m.color ?? "var(--s2)" }}>
                    {m.cover ? <img src={m.cover} alt="" loading="lazy" decoding="async" /> : null}
                  </div>
                  <h3>{m.title}</h3>
                  <div className="yours-card-meta">
                    <span>{m.kind}</span>
                    <span>{progressLabel(m)}</span>
                    {m.score != null && <span>{m.score}/10</span>}
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>

        <div className="tile">
          <div className="row-h" style={{ margin: 0 }}>
            <h2>Downloaded</h2>
          </div>
          <div className="empty">
            <b>Nothing downloaded yet</b>
            Offline copies will live here. The downloader is still ahead.
          </div>
        </div>
      </main>
    </>
  );
}
