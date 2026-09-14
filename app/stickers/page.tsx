import TopBar from "@/components/TopBar";
import StickerAlbum from "@/components/StickerAlbum";
import { listLibrary } from "@/lib/library";
import { currentProfile } from "@/lib/profile";
import { collectionFor } from "@/lib/stickers";

export const dynamic = "force-dynamic";

export default async function Stickers() {
  const me = await currentProfile();
  const titles = await collectionFor(me.id, listLibrary(me.id));
  const earned = titles.reduce((n, t) => n + t.earned, 0);
  const total = titles.reduce((n, t) => n + t.slots.length, 0);

  return (
    <>
      <TopBar active="Stickers" />
      <main className="stickers-page">
        <header className="settings-title">
          <span className="mono">
            {earned} / {total} · {me.name}&apos;s collection
          </span>
          <h1>Stickers</h1>
        </header>
        {titles.length === 0 ? (
          <section className="settings-card">
            <div className="empty">
              <b>Nothing to collect yet</b>
              Track a title, then watch or read. Anime awards a sticker every 15 minutes; manga
              and novels every 5 chapters.
            </div>
          </section>
        ) : (
          <StickerAlbum
            titles={titles.map((t) => ({
              via: t.via,
              id: t.id,
              title: t.title,
              href: t.href,
              earned: t.earned,
              slots: t.slots.map((s) => ({
                id: s.id,
                name: s.name,
                secret: s.secret,
                earned: s.earned,
                src: s.src,
              })),
            }))}
          />
        )}
      </main>
    </>
  );
}
