import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lacrima",
    short_name: "Lacrima",
    description: "Anime, manga, novels, movies and series. One place, everywhere.",
    start_url: "/",
    display: "standalone",
    background_color: "#0c0908",
    theme_color: "#0c0908",
    // logo.png and app/icon.png are both 1130x1130 PNGs; no other sizes exist.
    icons: [{ src: "/logo.png", sizes: "1130x1130", type: "image/png", purpose: "any" }],
  };
}
