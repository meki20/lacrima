import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import TopBar from "@/components/TopBar";
import { Failed } from "@/components/ui";
import type { MediaKind } from "@/lib/media";
import { backend, clearSourceHealth } from "@/lib/sources";
import { disabledIds, setSourceDisabled } from "@/lib/sources/store";

export const dynamic = "force-dynamic";

const KINDS: { id: MediaKind; label: string; hint: string; placeholder: string }[] = [
  {
    id: "manga",
    label: "Manga",
    hint: "Tachiyomi/Mihon index (Keiyoushi). Suwayomi runs these.",
    placeholder: "https://github.com/keiyoushi/extensions/raw/repo/index.pb",
  },
  {
    id: "anime",
    label: "Anime",
    hint: "Stremio addon or catalog (manifest.json). Keiyoushi and Aniyomi APK indexes will not run here.",
    placeholder: "https://v3-cinemeta.strem.io/manifest.json",
  },
  {
    id: "novel",
    label: "Novels",
    hint: "LNReader plugin manifest (plugins.min.json). Keiyoushi will not serve novels.",
    placeholder: "https://raw.githubusercontent.com/LNReader/lnreader-plugins/plugins/v3.0.0/.dist/plugins.min.json",
  },
];

function parseKind(raw: string | undefined): MediaKind {
  return raw === "anime" || raw === "novel" || raw === "manga" ? raw : "manga";
}

export default async function Sources({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kind?: string; err?: string }>;
}) {
  const sp = await searchParams;
  const kind = parseKind(sp.kind);
  const q = sp.q ?? "";
  const src = backend(kind);
  const here = `/sources?kind=${kind}`;

  const [repos, sources, extensions] = await Promise.all([
    src.listRepos(),
    src.listSources(),
    q || kind !== "manga" ? src.listExtensions(q) : Promise.resolve(null),
  ]);

  async function add(formData: FormData) {
    "use server";
    const k = parseKind(String(formData.get("kind")));
    const url = String(formData.get("indexUrl") ?? "").trim();
    if (url) {
      const added = await backend(k).addRepo(url);
      if (!added.ok) {
        redirect(`/sources?kind=${k}&err=${encodeURIComponent(added.reason)}`);
      }
      /* Anime/novel add already pulled the index. Manga only registers the URL. */
      if (k === "manga") await backend(k).refreshExtensions();
    }
    revalidatePath("/sources");
    redirect(`/sources?kind=${k}`);
  }

  async function remove(formData: FormData) {
    "use server";
    const k = parseKind(String(formData.get("kind")));
    await backend(k).removeRepo(String(formData.get("indexUrl")));
    revalidatePath("/sources");
  }

  async function refresh(formData: FormData) {
    "use server";
    await backend(parseKind(String(formData.get("kind")))).refreshExtensions();
    revalidatePath("/sources");
  }

  async function toggle(formData: FormData) {
    "use server";
    const k = parseKind(String(formData.get("kind")));
    await backend(k).setExtensionInstalled(
      String(formData.get("pkgName")),
      formData.get("install") === "1",
    );
    clearSourceHealth();
    revalidatePath("/sources");
    revalidatePath("/");
  }

  async function toggleSource(formData: FormData) {
    "use server";
    const k = parseKind(String(formData.get("kind")));
    const id = String(formData.get("sourceId"));
    const enable = formData.get("enable") === "1";
    if (k === "manga") setSourceDisabled(k, id, !enable);
    else await backend(k).setExtensionInstalled(id, enable);
    clearSourceHealth();
    revalidatePath("/sources");
    revalidatePath("/");
  }

  const remote = sources.ok ? sources.value.filter((s) => !s.isLocal) : [];
  const off = disabledIds(kind);
  const meta = KINDS.find((k) => k.id === kind)!;
  const extList = extensions;

  return (
    <>
      <TopBar active="" />
      <main style={{ maxWidth: 820 }} suppressHydrationWarning>
        <div className="filters">
          {KINDS.map((k) => (
            <a
              key={k.id}
              className={`chip${kind === k.id ? " on" : ""}`}
              href={`/sources?kind=${k.id}`}
            >
              {k.label}
            </a>
          ))}
        </div>

        <section>
          <div className="row-h">
            <h2>{meta.label} repositories</h2>
            <form action={refresh} style={{ marginLeft: "auto" }}>
              <input type="hidden" name="kind" value={kind} />
              <button className="btn" type="submit">
                Refresh index
              </button>
            </form>
          </div>
          <p style={{ color: "var(--tx2)", fontSize: 13, margin: "0 0 16px" }}>
            {meta.hint} Lacrima ships none — you add the repository.
          </p>
          {sp.err ? <Failed reason={sp.err} /> : null}

          {!repos.ok ? (
            <Failed reason={repos.reason} />
          ) : repos.value.length === 0 ? (
            <div className="empty">
              <b>No {meta.label.toLowerCase()} repositories</b>
              Paste an index URL below. Manga, anime and novels are separate lists on
              purpose — a manga repo cannot serve the other two.
            </div>
          ) : (
            <div className="rows">
              {repos.value.map((r) => (
                <div className="row" key={r.indexUrl}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <h3>{r.name ?? "Unnamed repository"}</h3>
                    <span className="url">{r.indexUrl}</span>
                  </div>
                  <span className="badge">{meta.label.toLowerCase()}</span>
                  <span className="badge">
                    {r.isLegacy ? "json" : "protobuf"}
                  </span>
                  <span className="badge">{r.extensionCount} extensions</span>
                  <form action={remove}>
                    <input type="hidden" name="kind" value={kind} />
                    <input type="hidden" name="indexUrl" value={r.indexUrl} />
                    <button className="btn" type="submit">
                      Remove
                    </button>
                  </form>
                </div>
              ))}
            </div>
          )}

          <form action={add} autoComplete="off" style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <input type="hidden" name="kind" value={kind} />
            <input
              name="indexUrl"
              type="url"
              required
              placeholder={meta.placeholder}
              style={{ flex: 1 }}
            />
            <button className="btn primary" type="submit">
              Add repository
            </button>
          </form>
        </section>

        <section>
          <div className="row-h">
            <h2>Extensions</h2>
          </div>
          <form method="get" style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <input type="hidden" name="kind" value={kind} />
            <input
              name="q"
              type="search"
              defaultValue={q}
              placeholder={`Search ${meta.label.toLowerCase()} extensions`}
              style={{ flex: 1 }}
            />
            <button className="btn" type="submit">
              Search
            </button>
          </form>

          {!q && kind === "manga" ? (
            <p style={{ color: "var(--tx3)", fontSize: 13 }}>
              Search to install one. There are too many to list.
            </p>
          ) : null}

          {extList === null ? null : !extList.ok ? (
            <Failed reason={extList.reason} />
          ) : extList.value.length === 0 ? (
            <div className="empty">
              <b>{q ? `No extension matches "${q}"` : `No ${meta.label.toLowerCase()} extensions installed`}</b>
              {q ? "Try a different name, or refresh the index above." : "Add a repository, then search to install."}
            </div>
          ) : (
            <div className="rows">
              {(kind === "manga" ? extList.value.slice(0, 25) : extList.value).map((e) => (
                <form className={`row${e.isInstalled ? "" : " off"}`} action={toggle} key={e.pkgName}>
                  <input type="hidden" name="kind" value={kind} />
                  <input type="hidden" name="pkgName" value={e.pkgName} />
                  <input type="hidden" name="install" value={e.isInstalled ? "0" : "1"} />
                  {e.iconUrl && (
                    <img
                      src={e.iconUrl}
                      alt=""
                      width={28}
                      height={28}
                      style={{ borderRadius: 6 }}
                    />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3>{e.name}</h3>
                    <span className="url">
                      {e.lang} · {e.version}
                    </span>
                  </div>
                  {e.isInstalled ? (
                    <span className="dot" style={{ background: "var(--ok)" }} />
                  ) : (
                    <span className="badge">off</span>
                  )}
                  <button className={e.isInstalled ? "btn" : "btn primary"} type="submit">
                    {kind === "manga"
                      ? e.isInstalled
                        ? "Uninstall"
                        : "Install"
                      : e.isInstalled
                        ? "Disable"
                        : "Enable"}
                  </button>
                </form>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="row-h">
            <h2>{meta.label} sources</h2>
            <a href={here}>
              {remote.filter((s) => !off.has(s.id)).length} of {remote.length} on
            </a>
          </div>
          {!sources.ok ? (
            <Failed reason={sources.reason} />
          ) : remote.length === 0 ? (
            <div className="empty">
              <b>No remote {meta.label.toLowerCase()} sources</b>
              {kind === "manga" ? "Install an extension above." : "Enable an extension above."}
            </div>
          ) : (
            <div className="rows">
              {remote.map((s) => {
                const on = !off.has(s.id);
                return (
                  <form className={`row${on ? "" : " off"}`} action={toggleSource} key={s.id}>
                    <input type="hidden" name="kind" value={kind} />
                    <input type="hidden" name="sourceId" value={s.id} />
                    <input type="hidden" name="enable" value={on ? "0" : "1"} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <h3>{s.name}</h3>
                      <span className="url">
                        {s.lang} / {s.kind} / {s.id}
                      </span>
                    </div>
                    <span className="badge">{s.kind}</span>
                    {on ? (
                      <span className="dot" style={{ background: "var(--ok)" }} />
                    ) : (
                      <span className="badge">off</span>
                    )}
                    <button className={on ? "btn" : "btn primary"} type="submit">
                      {on ? "Disable" : "Enable"}
                    </button>
                  </form>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
