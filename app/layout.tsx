import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { currentProfile } from "@/lib/profile";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], weight: ["400", "500"], variable: "--geist-sans" });
const mono = Geist_Mono({ subsets: ["latin"], weight: ["400"], variable: "--geist-mono" });

export const metadata: Metadata = {
  title: "Lacrima",
  description: "Anime, manga and novels. One place, everywhere.",
};

export const viewport: Viewport = {
  themeColor: "#0c0908",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const me = await currentProfile();

  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      {/* Theming is first-class: accent is per-profile, applied at the root. */}
      {/* suppressHydrationWarning: password managers and colour-picker extensions
          inject attributes on <body> before React attaches (cz-shortcut-listen,
          grammarly-*). Nothing we render here is client-dependent. */}
      <body suppressHydrationWarning style={{ ["--accent" as string]: me.accent }}>
        {children}
      </body>
    </html>
  );
}
