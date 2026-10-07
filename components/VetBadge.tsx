"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { VetKind, VetView } from "@/lib/vet";

/**
 * A source's score and the icon that vets it again.
 *
 * Lives inside rows that are forms, so the retry is a plain button that never
 * submits. While a vet runs (it takes a few seconds to a minute) it polls the
 * one source's state, then refreshes the page so the list order and the on/off
 * state, which a first vet may have changed, are the server's.
 */
export default function VetBadge({
  kind,
  id,
  name,
  initial,
}: {
  kind: VetKind;
  id: string;
  name: string;
  initial: VetView;
}) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  useEffect(() => setView(initial), [initial]);

  const pending = view.state === "pending";
  useEffect(() => {
    if (!pending) return;
    const tick = setInterval(async () => {
      try {
        const r = await fetch(`/api/vet?kind=${kind}&id=${encodeURIComponent(id)}`, { cache: "no-store" });
        if (!r.ok) return;
        const next = ((await r.json()) as { view: VetView }).view;
        setView(next);
        if (next.state !== "pending") router.refresh();
      } catch {
        /* Offline for a moment: the next tick asks again. */
      }
    }, 2_500);
    return () => clearInterval(tick);
  }, [pending, kind, id, router]);

  async function retry() {
    setView({ state: "pending", tip: "Vetting against ten fixed titles…" });
    try {
      const r = await fetch("/api/vet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, id }),
      });
      if (r.ok) setView(((await r.json()) as { view: VetView }).view);
      else setView({ state: "unsure", tip: "Could not start the vet. Try again." });
    } catch {
      setView({ state: "unsure", tip: "Could not reach the server. Try again." });
    }
  }

  const label =
    view.state === "ok" ? view.score!.toFixed(1) : view.state === "na" ? "n/a" : pending ? "vetting" : "—";
  return (
    <span className="vet-wrap">
      <span className={`vet${view.tone ? ` ${view.tone}` : ""}`} title={view.tip} role="status">
        {view.tone ? <i aria-hidden /> : null}
        {label}
      </span>
      {view.state === "na" ? null : (
        <button
          type="button"
          className="vet-retry"
          onClick={retry}
          disabled={pending}
          aria-label={`Vet ${name} again`}
          title={pending ? "Vetting…" : "Vet again"}
        >
          <svg
            className={pending ? "spinning" : undefined}
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M20 12a8 8 0 1 1-2.4-5.7" />
            <path d="M20 4v5h-5" />
          </svg>
        </button>
      )}
    </span>
  );
}
