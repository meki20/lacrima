import { Suspense } from "react";
import Link from "next/link";
import { currentProfile } from "@/lib/profile";
import { allRemoteSources } from "@/lib/sources";
import SearchField from "./SearchField";
import StickerPicker from "./StickerPicker";

/** Ambient health: reachable + how many remote sources are usable right now. */
async function health() {
  const r = await allRemoteSources();
  if (!r.ok) return { color: "var(--danger)", label: "backend down", title: r.reason };
  const by = { manga: 0, anime: 0, novel: 0 };
  for (const s of r.value) by[s.kind]++;
  const parts = (["manga", "anime", "novel"] as const)
    .map((k) => (by[k] ? `${by[k]} ${k === "novel" ? "novels" : k}` : null))
    .filter(Boolean);
  const n = r.value.length;
  return n === 0
    ? { color: "var(--warn)", label: "no sources", title: "No source repositories added yet" }
    : {
        color: "var(--ok)",
        label: parts.join(" · ") || `${n} sources`,
        title: r.value.map((s) => `${s.kind}: ${s.name}`).join(", "),
      };
}

async function HealthChip() {
  const hp = await health();
  return (
    <Link href="/sources" className="health" title={hp.title}>
      <span className="dot" style={{ background: hp.color }} />
      <span>{hp.label}</span>
    </Link>
  );
}

const TABS = [
  ["Home", "/", "M4 10.5 12 3l8 7.5V20h-6v-6H10v6H4z"],
  ["Anime", "/anime", "M8 5.5v13l11-6.5z"],
  ["Manga", "/manga", "M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 0-3 3V4z"],
  ["Novels", "/novels", "M12 5c-2-1.2-5-1.5-8-.8v14c3-.7 6-.4 8 .8 2-1.2 5-1.5 8-.8v-14c-3-.7-6-.4-8 .8z"],
  ["Yours", "/yours", "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5.5 20a6.5 6.5 0 0 1 13 0"],
] as const;

const MORE = [
  ["Stickers", "/stickers", "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2"],
  ["Sources", "/sources", "M12 4l8 4-8 4-8-4 8-4zM4 12l8 4 8-4M4 16l8 4 8-4"],
  ["Settings", "/settings", "settings"],
] as const;

type Tab = (typeof TABS)[number] | (typeof MORE)[number];

function Icon({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {d === "settings" ? (
        <>
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </>
      ) : (
        <path d={d} />
      )}
    </svg>
  );
}

function Tabs({
  active,
  className,
  items = TABS,
}: {
  active: string;
  className: string;
  items?: readonly Tab[];
}) {
  return (
    <nav className={className}>
      {items.map(([label, href, d]) => (
        <Link key={label} href={href} className={`tab${label === active ? " on" : ""}`} aria-current={label === active ? "page" : undefined}>
          <Icon d={d} />
          {label}
        </Link>
      ))}
    </nav>
  );
}

export default async function TopBar({ active = "Home" }: { active?: string }) {
  const me = await currentProfile();

  return (
    <>
      <aside className="sidebar">
        <Link href="/" className="brand" aria-label="Lacrima">
          <img src="/logo.png" alt="" width="188" height="188" />
        </Link>
        <div>
          <div className="side-label">MENU</div>
          <Tabs active={active} className="tabs" />
          <hr className="side-rule" />
          <Tabs active={active} className="tabs" items={MORE} />
        </div>
      </aside>
      <div className="topbar">
        <Link href="/" className="brand" aria-label="Lacrima">
          <img src="/logo.png" alt="" width="40" height="40" />
        </Link>
        <Suspense fallback={<div className="search">Search everything</div>}>
          <SearchField />
        </Suspense>
        <div className="spacer" />
        {/* Permanent, ambient — never a banner that only appears on failure. */}
        <Suspense
          fallback={
            <Link href="/sources" className="health" title="Checking sources">
              <span className="dot" style={{ background: "var(--tx3)" }} />
              <span>sources</span>
            </Link>
          }
        >
          <HealthChip />
        </Suspense>
        <StickerPicker />
        <Link href="/profiles" className="pfp" style={{ background: me.avatar_color }}>
          {me.name[0]?.toUpperCase()}
        </Link>
      </div>

      <Tabs active={active} className="bottomnav" />
    </>
  );
}
