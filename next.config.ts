import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev server is routinely opened from phones on the local network. Next
  // protects HMR's WebSocket against unknown origins by default, so without
  // this the page renders but the client runtime never completes on the LAN.
  allowedDevOrigins: ["192.168.1.167"],
  // A stray package-lock.json in the home directory makes Turbopack infer the
  // wrong workspace root; pin it to this project.
  turbopack: { root: __dirname },
  // Ships a self-contained server directory, so the runtime image needs no
  // node_modules and no npm install on the server.
  output: "standalone",
  serverExternalPackages: ["webtorrent"],
};

export default nextConfig;
