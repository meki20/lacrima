import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { allProfiles, COOKIE, createProfile, MAX_PROFILES, topGenre } from "@/lib/profile";

export default async function Profiles({
  searchParams,
}: {
  searchParams: Promise<{ err?: string }>;
}) {
  const people = allProfiles();
  const err = (await searchParams).err;

  async function pick(formData: FormData) {
    "use server";
    const id = String(formData.get("id"));
    (await cookies()).set(COOKIE, id, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
    });
    redirect("/");
  }

  async function add(formData: FormData) {
    "use server";
    const created = createProfile(String(formData.get("name") ?? "Profile"));
    if ("error" in created) {
      redirect(`/profiles?err=${encodeURIComponent(created.error)}`);
    }
    (await cookies()).set(COOKIE, String(created.id), {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
    });
    redirect("/yours");
  }

  return (
    <div className="sheet">
      <div style={{ textAlign: "center" }}>
        <h1>Who&apos;s reading?</h1>
        {err && <p className="yours-muted">{err}</p>}
        <div className="people">
          {people.map((p) => (
            <form action={pick} key={p.id}>
              <input type="hidden" name="id" value={p.id} />
              <button className="person" type="submit">
                <div className="pfp" style={{ background: p.avatar_color }}>
                  {p.name[0]?.toUpperCase()}
                </div>
                <div>
                  <div style={{ fontSize: 15 }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: "var(--tx3)" }}>
                    {topGenre(p.id).toLowerCase()}
                  </div>
                </div>
              </button>
            </form>
          ))}
          {people.length < MAX_PROFILES && (
            <form action={add} className="person add-person">
              <button className="pfp add-pfp" type="submit" aria-label="Create profile">
                +
              </button>
              <input name="name" type="text" defaultValue="Profile" maxLength={24} aria-label="New profile name" />
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
