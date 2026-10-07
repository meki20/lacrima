"use client";

import { useEffect } from "react";

/**
 * What a crashed page says instead of Next's stock "This page couldn't load".
 * One line on what happened (never the message or a stack: server errors carry
 * neither in production anyway), a way to retry, a way out, and the digest so a
 * server log line can be found. Shared by app/error.tsx and app/global-error.tsx.
 */
export default function ErrorCard({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="empty" role="alert" style={{ width: "100%", maxWidth: 480, margin: "12vh auto 0" }}>
      <b>This page didn&apos;t load</b>
      Something failed while Lacrima was building it. Your library and progress are unaffected.
      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button type="button" className="btn primary" onClick={() => retry()}>
          Try again
        </button>
        {/* A plain anchor: after a crash a full load is the safest way out. */}
        <a className="btn" href="/">
          Back to Home
        </a>
      </div>
      {error.digest ? (
        <div className="mono" style={{ marginTop: 14 }}>
          ref {error.digest}
        </div>
      ) : null}
    </div>
  );
}
