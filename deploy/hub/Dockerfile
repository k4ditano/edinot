# Hub de Edinot en un contenedor (probado el 2026-11-15 en un VPS con Docker 28).
#
# Construir (desde la raíz del repo, tras `npm run build`):
#   docker build -f deploy/hub/Dockerfile -t edinot-hub .
# Ejecutar (los datos en un volumen; Caddy o nginx por delante con HTTPS):
#   docker run -d --name edinot-hub --restart unless-stopped \
#     -p 17870:17870 -v edinot-hub:/data \
#     -e EDINOT_HUB_PUBLIC_URL=https://<ip-o-dominio>:17870 edinot-hub
# El hub se cifra solo con un certificado propio (los equipos se emparejan con el ENLACE, que lleva su
# huella). Detrás de un proxy con HTTPS: -p 127.0.0.1:17870:17870 y -e EDINOT_HUB_TLS=0.
# Código para el primer equipo:
#   docker exec -it edinot-hub node /app/edinot.mjs pair
FROM node:22-alpine
WORKDIR /app
COPY dist/edinot.mjs dist/hub.mjs /app/
ENV EDINOT_HUB_DIR=/data \
    XDG_CONFIG_HOME=/data/.config \
    EDINOT_HUB_HOST=0.0.0.0 \
    EDINOT_HUB_PORT=17870
EXPOSE 17870
# Sin permisos de root dentro del contenedor. La carpeta de datos se crea y se le da dueño
# ANTES de declararla como volumen, o el volumen nace como root y el hub no puede escribir.
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME /data
USER node
CMD ["node", "/app/edinot.mjs", "serve", "--no-qr"]
