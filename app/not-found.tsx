import Link from "next/link";
import TopBar from "@/components/TopBar";

export default function NotFound() {
  return (
    <>
      <TopBar />
      <main>
        <div className="empty">
          <b>Nothing lives here</b>
          This link doesn&apos;t point at a page or title Lacrima knows. It may be mistyped, or the
          title may come from a provider that doesn&apos;t serve that kind. <Link href="/">Back to Home</Link>
        </div>
      </main>
    </>
  );
}
