# El hub de Edinot, en un servidor

El hub es el proceso pequeño que guarda tus notas. Cada ordenador con Edinot
ejecuta uno en local; para usar tus notas en varios ordenadores ejecutas otro en
un servidor **tuyo** (un VPS pequeño, o un PC siempre encendido) y emparejas tus
ordenadores con él. Nada de esto necesita la app de escritorio, una pantalla ni
interfaz gráfica: son dos archivos de terminal y un servicio.

[English](README.md) · **Español**

## Instalar

Necesitas un servidor Linux con **Node.js 20 o superior** y `systemd`.

```sh
# en tu equipo: copia el paquete de la release al servidor
scp edinot-hub-linux.tar.gz usuario@servidor:~

# en el servidor
tar xzf edinot-hub-linux.tar.gz
sudo sh install.sh
```

`edinot-hub-linux.tar.gz` está en cada [release][Releases]. El instalador crea el
usuario `edinot`, deja los datos en `/var/lib/edinot`, instala el servicio
`edinot-hub` y un comando `edinot` para administrarlo, y termina imprimiendo un
**enlace y un QR** para emparejar tu primer ordenador.

Deduce la IP pública del servidor de su propia interfaz de red (no pregunta a
ningún servicio externo). Si no puede, o quieres otra dirección:

```sh
sudo sh install.sh --public-url https://203.0.113.10:17870
```

Otras opciones: `--port 17870`, `--no-tls` (mira
[detrás de un proxy](#detrás-de-un-proxy)) y `sudo sh install.sh --uninstall`
(con `--purge` borra también los datos).

Si tu proveedor tiene un cortafuegos propio (OVH, Hetzner, AWS…), abre allí
también el puerto (el 17870 por defecto).

## Se cifra solo, sin dominio

Cuando el hub escucha fuera del servidor crea un certificado propio (en la
carpeta `tls/` de sus datos) y sirve por TLS. No necesitas dominio ni proxy.

**Cómo se evita que alguien se haga pasar por tu servidor:** el enlace de
emparejamiento (`edinot://pair?u=…&c=…&f=<huella>`) lleva la huella de ese
certificado. El ordenador nuevo comprueba que el servidor presenta justo ese
certificado y, desde entonces, solo acepta ese. Por eso hay que usar el
**enlace o el QR completo**: el código suelto (`ABCDE-FGHJK`) no lleva huella y
el ordenador se negará a hablar con un servidor de certificado propio. Si algún
día renuevas el certificado (`edinot serve --new-cert`), los ordenadores
emparejados dejan de fiarse y hay que emparejarlos otra vez.

## Añadir ordenadores

```sh
edinot pair                   # en el servidor: código de 5 minutos, enlace y QR
edinot devices                # quién está emparejado
edinot devices revoke <id>    # quitar uno: deja de sincronizar al instante
```

En la app, pega el enlace en **Ajustes → Sincronización**. Desde una terminal,
en el ordenador nuevo: `edinot join "<enlace>"`.

Un código sirve una vez. Cada ordenador recibe **su propia credencial**: la clave
maestra del hub no sale nunca del servidor, y usarla a través de la red da un 403.

## Compartir solo algunos vaults, con otra persona

```sh
edinot share Trabajo --read-only     # código/enlace/QR: acceso SOLO a ese vault, y solo para leer
edinot share Trabajo Proyectos       # lectura y escritura en esos dos vaults
edinot shares                        # accesos compartidos activos
edinot devices revoke <id>           # quitar uno: deja de sincronizar al instante
```

En la app: Ajustes → Sincronización → «Añadir otro equipo» → «Solo algunos vaults».

Cómo funciona y sus límites, sin adornos:

- **La unidad es el vault.** El texto de las notas vive dentro del documento de
  su vault, así que no se puede dar acceso a una carpeta o a una nota suelta sin
  cambiar cómo se guardan los datos.
- Quien recibe el acceso no puede leer ni cambiar ningún otro vault ni
  administrar el servidor (emparejar, ver o quitar equipos, importar). Con
  «solo lectura» el servidor descarta sus cambios, y el CLI lo avisa en vez de
  aparentar que se guardaron.
- **Sí ve los nombres de tus demás vaults** (el documento que los lista se le
  ofrece en solo lectura), no su contenido.
- **Quitar el acceso corta el futuro, no el pasado:** lo que ya se sincronizó
  al ordenador de esa persona sigue en su disco, y Edinot no puede borrarlo.
- Una app de escritorio se sincroniza con **un** servidor a la vez. Quien se une
  con un acceso compartido recibe esos vaults, pero sus propios vaults dejan de
  sincronizarse mientras esté unido. Para una persona con servidor propio, lo
  cómodo es usar el CLI o el MCP para el acceso compartido.

## Detrás de un proxy

Si prefieres un dominio y HTTPS normal, deja el hub en `127.0.0.1` y pon Caddy o
nginx delante:

```sh
sudo sh install.sh --no-tls --public-url https://hub.ejemplo.com
```

```caddy
hub.ejemplo.com {
    reverse_proxy 127.0.0.1:17870
}
```

El proxy tiene que reenviar también los WebSockets, que es lo que usa la
sincronización.

## Docker

Construye desde la raíz del repositorio, tras `npm ci && npm run build` (eso
crea `dist/edinot.mjs` y `dist/hub.mjs`, que la imagen copia):

```sh
docker build -f deploy/hub/Dockerfile -t edinot-hub .
docker run -d --name edinot-hub --restart unless-stopped \
  -p 17870:17870 -v edinot-hub:/data \
  -e EDINOT_HUB_PUBLIC_URL=https://<ip-o-nombre-del-servidor>:17870 edinot-hub
docker exec -u node edinot-hub node /app/edinot.mjs pair    # código, enlace y QR
```

Ejecuta `pair` con `-u node`: sin él el comando corre como root, que no es el
dueño de los datos. Detrás de un proxy, publica el puerto solo en `127.0.0.1` y
añade `-e EDINOT_HUB_TLS=0`.

## En un PC tuyo en vez de un VPS

Es el mismo programa: `edinot serve`. Para que ordenadores fuera de tu red lleguen
sin abrir puertos en el router, lo más sencillo es [Tailscale](https://tailscale.com)
o un túnel de Cloudflare.

## Copias de seguridad

Los datos son la carpeta `/var/lib/edinot` (`docs/` y `blobs/`). El hub guarda además
durante 14 días una copia diaria de cada documento que cambia, en `backups/` — en
el mismo disco, así que **haz también una copia fuera del servidor.** Para tener tus
notas en Markdown legible sin Edinot: `edinot export /ruta/destino --attachments`.

## Lo que todavía no hace

- No hay app para el móvil con la que escanear el QR; en escritorio se pega el enlace.
- No hay sincronización directa entre ordenadores: todos pasan por este servidor.
- El instalador se ha probado en Ubuntu 25.04 con systemd, y el contenedor con
  Docker 28. Otras distribuciones deberían funcionar, pero no se han probado.

[Releases]: https://github.com/k4ditano/edinot/releases
