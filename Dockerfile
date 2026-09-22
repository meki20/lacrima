# Node 24: `node:sqlite` is in the standard library there, which is the whole
# reason Lacrima carries no database driver.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS node

# NVIDIA's maintained ffmpeg build exposes NVENC. Its Ubuntu base runs the
# glibc-linked Node runtime and optional dependencies built on Debian Bookworm.
FROM jrottenberg/ffmpeg:8-nvidia AS run
WORKDIR /app
COPY --from=node /usr/local /usr/local
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
ENV LACRIMA_DB=/data/lacrima.db

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

# The database is the only state the app owns; everything else is a cache.
RUN mkdir -p /data && chown -R ubuntu:ubuntu /app /data
USER ubuntu
VOLUME /data
EXPOSE 3000
ENTRYPOINT []
CMD ["node", "server.js"]
