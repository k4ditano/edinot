# The Edinot hub, on a server

The hub is the small process that stores your notes. Every Edinot computer runs
one locally; to use your notes on several computers you also run one on a
server of your own (a small VPS, or a PC that is always on) and pair your
computers with it. Nothing here needs the desktop app, a screen or a graphical
interface: it is two terminal files and a service.

**English** · [Español](LEEME.md)

## Install

You need a Linux server with **Node.js 20 or newer**, and `systemd`.

```sh
# on your computer: copy the release package to the server
scp edinot-hub-linux.tar.gz user@server:~

# on the server
tar xzf edinot-hub-linux.tar.gz
sudo sh install.sh
```

`edinot-hub-linux.tar.gz` is attached to every [release][Releases]. The
installer creates an `edinot` user, keeps the data in `/var/lib/edinot`,
installs the `edinot-hub` service and an `edinot` command to manage it, and
finishes by printing a **link and a QR code** to pair your first computer.

It works out the server's public IP from its own network interface (it asks no
outside service). If it cannot, or you want another address:

```sh
sudo sh install.sh --public-url https://203.0.113.10:17870
```

Other options: `--port 17870`, `--no-tls` (see
[behind a reverse proxy](#behind-a-reverse-proxy)), and
`sudo sh install.sh --uninstall` (add `--purge` to delete the data too).

If your provider has a firewall of its own (OVH, Hetzner, AWS…), open the port
(17870 by default) there as well.

## It encrypts itself, with no domain

When the hub listens outside the server it creates a certificate for itself
(in the `tls/` folder of its data) and serves over TLS. You need neither a
domain nor a reverse proxy.

**How a stranger is kept from posing as your server:** the pairing link
(`edinot://pair?u=…&c=…&f=<fingerprint>`) carries the fingerprint of that
certificate. A new computer checks that the server presents exactly that
certificate and, from then on, accepts only that one. So use the **whole link
or the QR code**: the bare code (`ABCDE-FGHJK`) has no fingerprint, and the
computer will refuse to talk to a server with a certificate of its own. If you
ever renew the certificate (`edinot serve --new-cert`), the paired computers
stop trusting it and have to be paired again.

## Add computers

```sh
edinot pair                   # on the server: a 5-minute code, a link and a QR code
edinot devices                # who is paired
edinot devices revoke <id>    # remove one: it stops syncing at once
```

In the app, paste the link in **Settings → Sync**. From a terminal, on the new
computer: `edinot join "<link>"`.

A code works once. Each computer gets **its own credential**: the hub's master
key never leaves the server, and using it over the network gets a 403.

## Share only some vaults, with someone else

```sh
edinot share Work --read-only     # a code/link/QR that opens ONLY that vault, to read
edinot share Work Projects        # read and write on those two vaults
edinot shares                     # active shared accesses
edinot devices revoke <id>        # remove one: it stops syncing at once
```

In the app: Settings → Sync → «Add another device» → «Only some vaults».

How it works, and its limits, plainly:

- **The unit is the vault.** The text of the notes lives inside its vault's
  document, so access to a single folder or note cannot be given without
  changing how the data is stored.
- Whoever gets the access can neither read nor change any other vault, nor
  administer the server (pair, list or remove computers, import). With
  «read-only» the server discards their changes, and the CLI says so instead of
  pretending they were saved.
- **They do see the names of your other vaults** (the document that lists them
  is offered read-only), not their contents.
- **Removing someone stops future access, not the past:** what already synced
  to their computer stays on their disk, and Edinot cannot delete it.
- A desktop app syncs with **one** server at a time. Someone who joins with a
  shared access receives those vaults, but their own vaults stop syncing while
  they are joined. For a person with a server of their own, the CLI or MCP is
  the comfortable way to use a shared access.

## Behind a reverse proxy

If you prefer a domain and normal HTTPS, keep the hub on `127.0.0.1` and put
Caddy or nginx in front of it:

```sh
sudo sh install.sh --no-tls --public-url https://hub.example.com
```

```caddy
hub.example.com {
    reverse_proxy 127.0.0.1:17870
}
```

The proxy must forward WebSockets too, which is what sync uses.

## Docker

Build from the repository root, after `npm ci && npm run build` (that is what
makes `dist/edinot.mjs` and `dist/hub.mjs`, which the image copies):

```sh
docker build -f deploy/hub/Dockerfile -t edinot-hub .
docker run -d --name edinot-hub --restart unless-stopped \
  -p 17870:17870 -v edinot-hub:/data \
  -e EDINOT_HUB_PUBLIC_URL=https://<server-ip-or-name>:17870 edinot-hub
docker exec -u node edinot-hub node /app/edinot.mjs pair    # code, link and QR
```

Run `pair` with `-u node`: without it the command runs as root, which does not
own the data. Behind a reverse proxy, publish the port only on `127.0.0.1` and
add `-e EDINOT_HUB_TLS=0`.

## On a PC of your own instead of a VPS

It is the same program: `edinot serve`. For computers outside your network to
reach it without opening ports on your router, the easiest ways are
[Tailscale](https://tailscale.com) or a Cloudflare tunnel.

## Backups

The data is the `/var/lib/edinot` folder (`docs/` and `blobs/`). The hub also
keeps, for 14 days, a daily copy of every document that changes, in `backups/`
— on the same disk, so **keep a copy off the server too.** To have your notes as
readable Markdown without Edinot: `edinot export /path/to/folder --attachments`.

## What it does not do yet

- There is no phone app to scan the QR code with; on the desktop you paste the
  link.
- There is no direct computer-to-computer sync: every computer syncs through
  this server.
- The installer has been tried on Ubuntu 25.04 with systemd, and the container
  with Docker 28. Other distributions should work but have not been tried.

[Releases]: https://github.com/k4ditano/edinot/releases
