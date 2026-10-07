import TopBar from "@/components/TopBar";
import { Pending } from "@/components/ui";

export default function Loading() {
  return (
    <>
      <TopBar active="Movies" />
      <main aria-busy="true">
        <Pending />
      </main>
    </>
  );
}
