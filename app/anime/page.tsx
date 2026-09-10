import BrowsePage from "@/components/BrowsePage";

export const dynamic = "force-dynamic";

export default function Anime({
  searchParams,
}: {
  searchParams: Promise<{ genre?: string; page?: string }>;
}) {
  return <BrowsePage kind="anime" searchParams={searchParams} />;
}
