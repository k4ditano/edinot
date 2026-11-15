#!/bin/sh
# Instala el hub de Edinot como servicio en un servidor Linux (sin pantalla).
#
# Se ejecuta EN el servidor, como root, con los dos archivos construidos al lado:
#   edinot.mjs  y  hub.mjs
#
#   sudo sh install.sh                              # lo normal: cifrado con certificado propio
#   sudo sh install.sh --public-url https://IP:17870   # si no puede deducir su IP pública
#   sudo sh install.sh --no-tls --public-url https://hub.tu-dominio.com   # detrás de Caddy/nginx
#   sudo sh install.sh --uninstall [--purge]        # quitarlo (--purge borra también los datos)
#
# Qué hace: crea el usuario `edinot`, copia el programa a /opt/edinot, guarda los datos en
# /var/lib/edinot, instala un servicio de systemd y un comando `edinot` para el administrador, y al
# terminar imprime el enlace (y QR) para emparejar el primer equipo.
#
# El hub se cifra solo: genera un certificado propio y el enlace de emparejamiento lleva su huella,
# así los equipos comprueban que hablan con TU servidor sin necesidad de dominio.

set -eu

PUBLIC_URL=""
PORT=17870
TLS=1
UNINSTALL=0
PURGE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --public-url) PUBLIC_URL="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --no-tls) TLS=0; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    --purge) PURGE=1; shift ;;
    *) echo "opción desconocida: $1" >&2; exit 2 ;;
  esac
done

falla() { echo "ERROR: $1" >&2; exit 1; }
AQUI=$(cd "$(dirname "$0")" && pwd)
[ "$(id -u)" = 0 ] || falla "ejecútalo como root (sudo sh install.sh ...)"

if [ "$UNINSTALL" = 1 ]; then
  echo "== Quitando el servicio"
  systemctl disable --now edinot-hub.service 2>/dev/null || true
  rm -f /etc/systemd/system/edinot-hub.service /usr/local/bin/edinot
  systemctl daemon-reload 2>/dev/null || true
  rm -rf /opt/edinot /etc/edinot
  if [ "$PURGE" = 1 ]; then
    rm -rf /var/lib/edinot
    id edinot >/dev/null 2>&1 && userdel edinot 2>/dev/null || true
    echo "Datos y usuario borrados."
  else
    echo "Los datos siguen en /var/lib/edinot (usa --purge para borrarlos también)."
  fi
  echo "Hecho."
  exit 0
fi

[ -f "$AQUI/edinot.mjs" ] && [ -f "$AQUI/hub.mjs" ] || falla "faltan edinot.mjs y hub.mjs junto a este script"
command -v node >/dev/null 2>&1 || falla "hace falta Node.js 20 o superior (https://nodejs.org)"
NODE=$(command -v node)
MAJOR=$("$NODE" -p 'process.versions.node.split(".")[0]')
[ "$MAJOR" -ge 20 ] || falla "Node $MAJOR es antiguo: hace falta 20 o superior"

# Dirección con la que se llegará al hub. Sin --public-url se usa la IP pública de la propia interfaz
# de red (sin preguntar a ningún servicio externo).
if [ -z "$PUBLIC_URL" ]; then
  [ "$TLS" = 1 ] || falla "con --no-tls hace falta --public-url https://tu-dominio (la dirección de tu proxy)"
  IP=$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | \
    grep -vE '^(10\.|127\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.|169\.254\.)' | head -n 1 || true)
  [ -n "$IP" ] || falla "no encuentro una IP pública en este servidor: pásala con --public-url https://IP:$PORT"
  PUBLIC_URL="https://$IP:$PORT"
  echo "Dirección pública deducida: $PUBLIC_URL (cámbiala con --public-url si no es la buena)"
fi
case "$PUBLIC_URL" in http://*) echo "AVISO: la dirección es http; con cifrado propio se usará https."; PUBLIC_URL="https://${PUBLIC_URL#http://}" ;; esac

echo "== Usuario y carpetas"
id edinot >/dev/null 2>&1 || useradd --system --home-dir /var/lib/edinot --shell /usr/sbin/nologin edinot
mkdir -p /opt/edinot /var/lib/edinot /etc/edinot
cp "$AQUI/edinot.mjs" "$AQUI/hub.mjs" /opt/edinot/
chmod 755 /opt/edinot/edinot.mjs
chown -R edinot:edinot /var/lib/edinot
chmod 700 /var/lib/edinot

echo "== Configuración (/etc/edinot/hub.env)"
if [ "$TLS" = 1 ]; then HOST=0.0.0.0; else HOST=127.0.0.1; fi
cat > /etc/edinot/hub.env <<EOF
EDINOT_HUB_DIR=/var/lib/edinot
XDG_CONFIG_HOME=/var/lib/edinot/.config
EDINOT_HUB_HOST=$HOST
EDINOT_HUB_PORT=$PORT
EDINOT_HUB_PUBLIC_URL=$PUBLIC_URL
EDINOT_HUB_TLS=$TLS
EOF
chmod 644 /etc/edinot/hub.env

echo "== Servicio de systemd"
cat > /etc/systemd/system/edinot-hub.service <<EOF
[Unit]
Description=Hub de Edinot
After=network-online.target
Wants=network-online.target

[Service]
User=edinot
EnvironmentFile=/etc/edinot/hub.env
ExecStart=$NODE /opt/edinot/edinot.mjs serve --no-qr
Restart=on-failure
RestartSec=3
# El hub guarda el estado al parar: se le da tiempo para hacerlo.
TimeoutStopSec=30
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/edinot
PrivateTmp=true
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF

echo "== Comando «edinot» para el administrador"
cat > /usr/local/bin/edinot <<EOF
#!/bin/sh
# Ejecuta el CLI de Edinot como el usuario del servicio, con sus mismos datos.
exec sudo -u edinot env \$(cat /etc/edinot/hub.env | xargs) $NODE /opt/edinot/edinot.mjs "\$@"
EOF
chmod 755 /usr/local/bin/edinot

systemctl daemon-reload
systemctl enable --now edinot-hub.service
sleep 4
systemctl is-active --quiet edinot-hub.service || { journalctl -u edinot-hub --no-pager -n 15 >&2; falla "el servicio no arrancó (mira el registro de arriba)"; }

if [ "$TLS" = 1 ] && command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow "$PORT/tcp" >/dev/null 2>&1 && echo "Cortafuegos (ufw): abierto el puerto $PORT/tcp"
fi

echo
echo "LISTO. El hub está en marcha en $PUBLIC_URL"
if [ "$TLS" = 1 ]; then
  echo "Si tu proveedor tiene un cortafuegos propio (OVH, Hetzner, AWS…), abre también el puerto $PORT/tcp allí."
else
  echo "Pon Caddy o nginx con HTTPS delante apuntando a 127.0.0.1:$PORT (ver README.md)."
fi
echo
echo "Código para emparejar tu primer equipo (caduca en 5 minutos; sale otro con:  edinot pair):"
edinot pair || echo "(no se pudo generar el código ahora: ejecuta  edinot pair  en un momento)"
cat <<EOF

En tu equipo: Ajustes > Sincronización > pega el ENLACE (edinot://…) o, en terminal:  edinot join "<enlace>"
Ver quién está emparejado:  edinot devices     Quitar uno:  edinot devices revoke <id>
Registro del servicio:      journalctl -u edinot-hub -f
Desinstalar:                sudo sh install.sh --uninstall   (añade --purge para borrar también los datos)
EOF
