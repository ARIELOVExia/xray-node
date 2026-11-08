# syntax=docker/dockerfile:1
# Stage 1: the official xray-core image, used only as a source for the binary.
FROM ghcr.io/xtls/xray-core:latest AS xray

# Stage 2: Node runtime on Alpine. The official xray image is distroless
# and has no shell, so it cannot run the wrapper directly.
FROM node:20-alpine

COPY --from=xray /usr/local/bin/xray /usr/local/bin/xray

RUN addgroup -S app && adduser -S app -G app

WORKDIR /app
COPY package.json server.js ./
RUN chown -R app:app /app

# Run as a non-root user (AOZUMI flags images that run as root).
USER app

EXPOSE 8080
CMD ["node", "server.js"]
