"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export default function SearchField() {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const ref = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [value, setValue] = useState(params.get("q") ?? "");

  useEffect(() => {
    if (path !== "/search") return;
    if (document.activeElement === ref.current) return;
    setValue(params.get("q") ?? "");
  }, [path, params]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      if (path !== "/search") router.push("/search");
      ref.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [path, router]);

  useEffect(() => {
    if (path === "/search") ref.current?.focus();
  }, [path]);

  const commit = (q: string) => {
    const href = q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : "/search";
    if (path === "/search") router.replace(href);
    else router.push(href);
  };

  return (
    <input
      ref={ref}
      className="search"
      type="search"
      placeholder="Search everything"
      value={value}
      aria-label="Search everything"
      autoComplete="off"
      onChange={(e) => {
        const v = e.target.value;
        setValue(v);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => commit(v), 250);
      }}
    />
  );
}
