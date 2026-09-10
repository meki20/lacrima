import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A stray package-lock.json in the home directory makes Turbopack infer the
  // wrong workspace root; pin it to this project.
  turbopack: { root: __dirname },
  // Ships a self-contained server directory, so the runtime image needs no
  // node_modules and no npm install on the server.
  output: "standalone",
  serverExternalPackages: ["webtorrent"],
};

export default nextConfig;
