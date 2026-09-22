<p align="center">
  <img src="public/logo.png" alt="Lacrima" width="160">
</p>

# Lacrima

Self-hosted anime, manga, and novel library with one dark-first web UI and progress that follows each profile across devices.

Lacrima is metadata-first: it uses AniList, TMDB, and MangaUpdates for discovery, then asks extensions only to resolve the title the viewer chose. It ships with no source repositories or bundled sources.

## Run locally

Requires Node.js 24+.

```bash
npm ci
docker compose up -d
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Suwayomi runs on port 4567 for local development.

## Serve on your network

```bash
docker compose --profile serve up -d
tailscale serve --bg --https=443 http://127.0.0.1:7345
```

The server uses Caddy for the LAN route and Tailscale Serve for private HTTPS. Media comes from extension repositories you add yourself; Lacrima never provides or recommends sources.

## Development

```bash
npm test
npx tsc --noEmit
```

The Android client lives in [`android/`](android/README.md). Its server contract is documented in [`app/api/v1/`](app/api/v1/README.md).
