#!/bin/sh
# Installs the Edinot hub as a service on a Linux server (no screen needed).
#
# Run it ON the server, as root, with the two built files next to it:
#   edinot.mjs  and  hub.mjs
#
#   sudo sh install.sh                              # the usual: encrypted with its own certificate
#   sudo sh install.sh --public-url https://IP:17870   # if it cannot work out its public IP
#   sudo sh install.sh --no-tls --public-url https://hub.example.com      # behind Caddy/nginx
#   sudo sh install.sh --uninstall [--purge]        # remove it (--purge deletes the data too)
#
# What it does: creates the `edinot` user, copies the program to /opt/edinot, keeps the data in
# /var/lib/edinot, installs a systemd service and an `edinot` command for the admin, and prints the
# link (and QR code) to pair the first computer when it is done.
#
# The hub encrypts itself: it creates a certificate of its own and the pairing link carries its
# fingerprint, so computers can check they are talking to YOUR server with no domain needed.

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
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

fail() { echo "ERROR: $1" >&2; exit 1; }
HERE=$(cd "$(dirname "$0")" && pwd)
[ "$(id -u)" = 0 ] || fail "run it as root (sudo sh install.sh ...)"

if [ "$UNINSTALL" = 1 ]; then
  echo "== Removing the service"
  systemctl disable --now edinot-hub.service 2>/dev/null || true
  rm -f /etc/systemd/system/edinot-hub.service /usr/local/bin/edinot
  systemctl daemon-reload 2>/dev/null || true
  rm -rf /opt/edinot /etc/edinot
  if [ "$PURGE" = 1 ]; then
    rm -rf /var/lib/edinot
    id edinot >/dev/null 2>&1 && userdel edinot 2>/dev/null || true
    echo "Data and user deleted."
  else
    echo "The data is still in /var/lib/edinot (use --purge to delete it too)."
  fi
  echo "Done."
  exit 0
fi

[ -f "$HERE/edinot.mjs" ] && [ -f "$HERE/hub.mjs" ] || fail "edinot.mjs and hub.mjs must be next to this script"
command -v node >/dev/null 2>&1 || fail "Node.js 20 or newer is required (https://nodejs.org)"
NODE=$(command -v node)
MAJOR=$("$NODE" -p 'process.versions.node.split(".")[0]')
[ "$MAJOR" -ge 20 ] || fail "Node $MAJOR is too old: 20 or newer is required"

# The address the hub will be reached at. Without --public-url the public IP of the server's own
# network interface is used (no outside service is asked).
if [ -z "$PUBLIC_URL" ]; then
  [ "$TLS" = 1 ] || fail "with --no-tls you need --public-url https://your-domain (your proxy's address)"
  IP=$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | \
    grep -vE '^(10\.|127\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.|169\.254\.)' | head -n 1 || true)
  [ -n "$IP" ] || fail "no public IP found on this server: pass it with --public-url https://IP:$PORT"
  PUBLIC_URL="https://$IP:$PORT"
  echo "Public address worked out: $PUBLIC_URL (change it with --public-url if it is not the right one)"
fi
case "$PUBLIC_URL" in http://*) echo "NOTE: the address is http; with its own encryption https will be used."; PUBLIC_URL="https://${PUBLIC_URL#http://}" ;; esac

echo "== User and folders"
id edinot >/dev/null 2>&1 || useradd --system --home-dir /var/lib/edinot --shell /usr/sbin/nologin edinot
mkdir -p /opt/edinot /var/lib/edinot /etc/edinot
cp "$HERE/edinot.mjs" "$HERE/hub.mjs" /opt/edinot/
chmod 755 /opt/edinot/edinot.mjs
chown -R edinot:edinot /var/lib/edinot
chmod 700 /var/lib/edinot

echo "== Configuration (/etc/edinot/hub.env)"
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

echo "== systemd service"
cat > /etc/systemd/system/edinot-hub.service <<EOF
[Unit]
Description=Edinot hub
After=network-online.target
Wants=network-online.target

[Service]
User=edinot
EnvironmentFile=/etc/edinot/hub.env
ExecStart=$NODE /opt/edinot/edinot.mjs serve --no-qr
Restart=on-failure
RestartSec=3
# The hub saves its state when it stops: give it time to do so.
TimeoutStopSec=30
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/edinot
PrivateTmp=true
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF

echo "== The \"edinot\" command for the admin"
cat > /usr/local/bin/edinot <<EOF
#!/bin/sh
# Runs the Edinot CLI as the service user, with the same data.
exec sudo -u edinot env \$(cat /etc/edinot/hub.env | xargs) $NODE /opt/edinot/edinot.mjs "\$@"
EOF
chmod 755 /usr/local/bin/edinot

systemctl daemon-reload
systemctl enable --now edinot-hub.service
sleep 4
systemctl is-active --quiet edinot-hub.service || { journalctl -u edinot-hub --no-pager -n 15 >&2; fail "the service did not start (see the log above)"; }

if [ "$TLS" = 1 ] && command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow "$PORT/tcp" >/dev/null 2>&1 && echo "Firewall (ufw): port $PORT/tcp opened"
fi

echo
echo "DONE. The hub is running at $PUBLIC_URL"
if [ "$TLS" = 1 ]; then
  echo "If your provider has a firewall of its own (OVH, Hetzner, AWS…), open port $PORT/tcp there too."
else
  echo "Put Caddy or nginx with HTTPS in front, pointing at 127.0.0.1:$PORT (see README.md)."
fi
echo
echo "Code to pair your first computer (expires in 5 minutes; get another with:  edinot pair):"
edinot pair || echo "(could not generate the code just now: run  edinot pair  in a moment)"
cat <<EOF

On your computer: Settings > Sync > paste the LINK (edinot://…) or, in a terminal:  edinot join "<link>"
See who is paired:   edinot devices     Remove one:  edinot devices revoke <id>
Service log:         journalctl -u edinot-hub -f
Uninstall:           sudo sh install.sh --uninstall   (add --purge to delete the data too)
EOF
