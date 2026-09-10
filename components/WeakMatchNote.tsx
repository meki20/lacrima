"use client";

import { useEffect, useState } from "react";
import { dismissWeak, weakDismissed } from "@/lib/match";

const STORE = "lacrima-weak-dismiss";

export default function WeakMatchNote({
  storeKey,
  sourceTitle,
  confidence,
  href,
  change,
}: {
  storeKey: string;
  sourceTitle: string;
  confidence: number;
  href: string;
  change: boolean;
}) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    setHidden(weakDismissed(localStorage.getItem(STORE), storeKey));
  }, [storeKey]);
  if (hidden) return null;
  return (
    <div className="note">
      <span className="dot" style={{ background: "var(--warn)" }} />
      Matched to <b>&nbsp;{sourceTitle}&nbsp;</b> — only {Math.round(confidence * 100)}% confident.
      <a href={href} style={{ marginLeft: "auto", color: "var(--accent)" }}>
        {change ? "Never mind" : "Pick another"}
      </a>
      <button
        type="button"
        className="note-dismiss"
        onClick={() => {
          localStorage.setItem(STORE, dismissWeak(localStorage.getItem(STORE), storeKey));
          setHidden(true);
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
