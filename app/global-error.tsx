"use client";

import ErrorCard from "@/components/ErrorCard";
import "./globals.css";

/**
 * The last resort: the root layout itself threw (it reads the profile, so a
 * database fault lands here). It replaces the layout, so it brings its own
 * document and stylesheet; fonts fall back to the system stack.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main>
          <ErrorCard error={error} retry={retry} />
        </main>
      </body>
    </html>
  );
}
