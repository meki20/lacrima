import BrowsePage from "@/components/BrowsePage";

export const dynamic = "force-dynamic";

export default function Movies({
  searchParams,
}: {
  searchParams: Promise<{ genre?: string; page?: string }>;
}) {
  return <BrowsePage kind="movie" searchParams={searchParams} />;
}
