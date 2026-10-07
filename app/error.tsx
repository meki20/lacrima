"use client";

import ErrorCard from "@/components/ErrorCard";

/**
 * Any page, layout-below, that throws while rendering. notFound() and redirect()
 * never land here (Next routes them past error boundaries to not-found.tsx).
 * `retry` re-fetches the segment from the server; `reset` would only re-render
 * the same failed payload.
 */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main>
      <ErrorCard error={error} retry={retry} />
    </main>
  );
}
