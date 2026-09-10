import TopBar from "@/components/TopBar";
import { Pending } from "@/components/ui";

export default function Loading() {
  return (
    <>
      <TopBar active="" />
      <main aria-busy="true">
        <Pending rails={2} tiles={8} />
      </main>
    </>
  );
}
