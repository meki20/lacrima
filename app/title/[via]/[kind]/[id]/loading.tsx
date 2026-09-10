import TopBar from "@/components/TopBar";
import { Pending } from "@/components/ui";

export default function Loading() {
  return (
    <>
      <TopBar />
      {/* Same height as the real hero, so the page does not jump when it lands. */}
      <div className="hero skel" style={{ borderRadius: 0 }} />
      <main aria-busy="true">
        <Pending rails={1} />
      </main>
    </>
  );
}
