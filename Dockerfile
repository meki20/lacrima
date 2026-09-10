# Node 24: `node:sqlite` is in the standard library there, which is the whole
# reason Lacrima carries no database driver.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
ENV LACRIMA_DB=/data/lacrima.db

# Sources ship one file carrying Hindi, English and Japanese audio, and a browser
# cannot choose between them — Chrome exposes no `audioTracks` at all. ffmpeg picks
# the track and normalises audio the browser refuses (DDP, AC3, DTS, FLAC). Video
# is always a stream copy, so this costs a subprocess, not a transcode.
RUN apk add --no-cache ffmpeg

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

# The database is the only state the app owns; everything else is a cache.
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME /data
EXPOSE 3000
CMD ["node", "server.js"]
