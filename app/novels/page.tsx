import BrowsePage from "@/components/BrowsePage";

export const dynamic = "force-dynamic";

export default function Novels({
  searchParams,
}: {
  searchParams: Promise<{ genre?: string; page?: string }>;
}) {
  return <BrowsePage kind="novel" searchParams={searchParams} />;
}
