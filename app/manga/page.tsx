import BrowsePage from "@/components/BrowsePage";

export const dynamic = "force-dynamic";

export default function Manga({
  searchParams,
}: {
  searchParams: Promise<{ genre?: string; page?: string }>;
}) {
  return <BrowsePage kind="manga" searchParams={searchParams} />;
}
