import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { allProfiles, COOKIE, topGenre } from "@/lib/profile";

export default function Profiles() {
  const people = allProfiles();

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

  return (
    <div className="sheet">
      <div style={{ textAlign: "center" }}>
        <h1>Who&apos;s reading?</h1>
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
        </div>
      </div>
    </div>
  );
}
