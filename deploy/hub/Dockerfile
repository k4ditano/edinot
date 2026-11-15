# The Edinot hub in a container (tried on a VPS with Docker 28).
#
# Build (from the repository root, after `npm ci && npm run build`):
#   docker build -f deploy/hub/Dockerfile -t edinot-hub .
# Run (data in a volume):
#   docker run -d --name edinot-hub --restart unless-stopped \
#     -p 17870:17870 -v edinot-hub:/data \
#     -e EDINOT_HUB_PUBLIC_URL=https://<ip-or-domain>:17870 edinot-hub
# The hub encrypts itself with a certificate of its own (devices pair with the LINK, which carries
# its fingerprint). Behind an HTTPS reverse proxy: -p 127.0.0.1:17870:17870 and -e EDINOT_HUB_TLS=0.
# Code for the first device:
#   docker exec -u node edinot-hub node /app/edinot.mjs pair
FROM node:22-alpine
WORKDIR /app
COPY dist/edinot.mjs dist/hub.mjs /app/
ENV EDINOT_HUB_DIR=/data \
    XDG_CONFIG_HOME=/data/.config \
    EDINOT_HUB_HOST=0.0.0.0 \
    EDINOT_HUB_PORT=17870
EXPOSE 17870
# No root inside the container. The data folder is created and given its owner BEFORE it is
# declared a volume, or the volume is born as root and the hub cannot write to it.
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME /data
USER node
CMD ["node", "/app/edinot.mjs", "serve", "--no-qr"]
